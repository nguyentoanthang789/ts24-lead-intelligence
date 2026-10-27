// POST /api/outreach/draft — tạo bản nháp tin nhắn từ template
// Quy tắc: chỉ render từ dữ liệu thực tế; biến thiếu → báo missingVariables, KHÔNG bịa
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { renderTemplate, buildVerifiedContext } from "@/server/templates";
import { getScoringConfig } from "@/server/settings";
import { isSuppressed } from "@/server/compliance";

const BodySchema = z.object({
  companyId: z.string().min(1),
  templateId: z.string().min(1),
  taskId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, BodySchema);

    const company = await db.company.findUnique({
      where: { id: body.companyId },
      include: { contactPoints: true, evidences: { orderBy: { recordedAt: "desc" } }, productFits: { orderBy: { fitScore: "desc" }, take: 1 } },
    });
    if (!company) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy doanh nghiệp");

    // COMPLIANCE: chặn draft cho lead bị loại trừ
    const suppressed = await isSuppressed(company);
    if (suppressed.suppressed) throw new ApiError(403, "SUPPRESSED", `Doanh nghiệp bị loại trừ khỏi tiếp cận: ${suppressed.reason}`);
    if (company.outreachStatus === "DO_NOT_CONTACT") throw new ApiError(403, "SUPPRESSED", "Doanh nghiệp ở trạng thái không tiếp tục liên hệ");

    const template = await db.messageTemplate.findUnique({ where: { id: body.templateId } });
    if (!template) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy mẫu tin nhắn");

    const config = await getScoringConfig();
    const topFit = company.productFits[0];
    const productName = topFit
      ? (await db.product.findUnique({ where: { code: topFit.productCode } }))?.name ?? `Sản phẩm ${topFit.productCode}`
      : null;
    // verified_business_context CHỈ từ bằng chứng đã ghi nhận — không tạo nhu cầu giả
    const verifiedContext = buildVerifiedContext(
      company.evidences.map((e) => ({ kind: e.kind, summary: e.summary, confidence: e.confidence, sourceName: e.sourceName })),
      company.sector,
      company.province
    );
    const senderName = (await db.appSetting.findUnique({ where: { key: "sender_name" } }))?.value || "";

    const rendered = renderTemplate(template.body, {
      company_name: company.name,
      business_sector: company.sector,
      product_name: productName,
      verified_business_context: verifiedContext,
      sender_name: senderName || null,
    });
    void config;

    // lưu draft vào task nếu có
    if (body.taskId) {
      await db.outreachTask.update({
        where: { id: body.taskId },
        data: { draftContent: rendered.content, templateId: template.id, status: "CONTENT_READY" },
      });
      await db.outreachEvent.create({
        data: { companyId: company.id, taskId: body.taskId, type: "DRAFT_CREATED", note: `Tạo bản nháp từ mẫu "${template.name}"`, actor: "operator" },
      });
      if (company.outreachStatus === "NEW" || company.outreachStatus === "AWAITING_CONTACT") {
        await db.company.update({ where: { id: company.id }, data: { outreachStatus: "CONTENT_READY" } });
      }
    }

    return ok({
      content: rendered.content,
      missingVariables: rendered.missingVariables,
      // biến thiếu phải được người dùng bổ sung/sửa trước khi sao chép — không tự điền
      requiresReview: rendered.missingVariables.length > 0,
      verifiedContextUsed: verifiedContext,
    });
  } catch (err) {
    return handleError(err);
  }
}
