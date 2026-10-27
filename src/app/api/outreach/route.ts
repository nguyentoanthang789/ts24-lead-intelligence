// GET /api/outreach — hàng đợi tiếp cận (lọc theo trạng thái/campaign)
// POST /api/outreach — đưa lead vào hàng đợi (chặn suppression + DO_NOT_CONTACT)
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, parseQuery, requireMutationAuth, ApiError, getPagination } from "@/server/http";
import { isSuppressed } from "@/server/compliance";

export async function GET(req: NextRequest) {
  try {
    const { skip, take, page, pageSize } = getPagination(req);
    const query = parseQuery(req, z.object({
      status: z.string().optional(),
      campaignId: z.string().optional(),
    }));
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.campaignId) where.campaignId = query.campaignId;
    const [total, tasks] = await Promise.all([
      db.outreachTask.count({ where }),
      db.outreachTask.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip, take,
        include: {
          company: { select: { id: true, name: true, taxCode: true, province: true, priorityTier: true, contactPoints: true, productFits: { orderBy: { fitScore: "desc" }, take: 2 } } },
          campaign: { select: { id: true, name: true } },
        },
      }),
    ]);
    return ok({ items: tasks, total, page, pageSize });
  } catch (err) {
    return handleError(err);
  }
}

const CreateSchema = z.object({
  companyIds: z.array(z.string()).min(1).max(100),
  campaignId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    const created: string[] = [];
    const blocked: { companyId: string; reason: string }[] = [];

    for (const companyId of body.companyIds) {
      const company = await db.company.findUnique({
        where: { id: companyId },
        include: { contactPoints: true },
      });
      if (!company) {
        blocked.push({ companyId, reason: "Không tìm thấy doanh nghiệp" });
        continue;
      }
      // COMPLIANCE: chặn lead nằm trong danh sách loại trừ
      const suppressed = await isSuppressed(company);
      if (suppressed.suppressed) {
        blocked.push({ companyId, reason: `Bị loại trừ: ${suppressed.reason}` });
        continue;
      }
      if (company.outreachStatus === "DO_NOT_CONTACT") {
        blocked.push({ companyId, reason: "Doanh nghiệp ở trạng thái không tiếp tục liên hệ" });
        continue;
      }
      // tránh task trùng active cho cùng công ty
      const existingActive = await db.outreachTask.findFirst({
        where: { companyId, status: { in: ["NEW", "CONTENT_READY", "AWAITING_CONTACT", "FOLLOW_UP"] } },
      });
      if (existingActive) {
        blocked.push({ companyId, reason: "Đã có công việc tiếp cận đang mở" });
        continue;
      }
      const task = await db.outreachTask.create({
        data: { companyId, campaignId: body.campaignId ?? null, status: "NEW" },
      });
      await db.company.update({ where: { id: companyId }, data: { outreachStatus: "AWAITING_CONTACT" } });
      await db.outreachEvent.create({
        data: { companyId, taskId: task.id, type: "DRAFT_CREATED", note: "Đưa vào hàng đợi tiếp cận", actor: "operator" },
      });
      created.push(task.id);
    }
    return ok({ created, blocked }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
