// GET/POST/DELETE /api/suppression — danh sách không tiếp tục liên hệ
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { audit } from "@/server/compliance";

export async function GET() {
  try {
    const entries = await db.suppressionEntry.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
    return ok(entries);
  } catch (err) {
    return handleError(err);
  }
}

const CreateSchema = z.object({
  value: z.string().min(3).max(200),
  scope: z.string().default("GLOBAL"),
  reason: z.string().max(500).optional(),
  companyId: z.string().optional(), // nếu thêm theo company — tự tính các giá trị định danh
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    const values: string[] = [];
    if (body.companyId) {
      const company = await db.company.findUnique({
        where: { id: body.companyId },
        include: { contactPoints: true },
      });
      if (!company) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy doanh nghiệp");
      values.push(company.id);
      if (company.taxCode) values.push(company.taxCode);
      if (company.domain) values.push(company.domain);
      for (const c of company.contactPoints) {
        if (["PHONE", "EMAIL", "ZALO"].includes(c.type)) values.push(c.normalized);
      }
    } else {
      values.push(body.value);
    }
    let count = 0;
    for (const v of values) {
      await db.suppressionEntry.upsert({
        where: { value_scope: { value: v, scope: body.scope } },
        create: { value: v, scope: body.scope, reason: body.reason ?? null },
        update: { reason: body.reason ?? null },
      });
      count++;
    }
    // nếu có companyId: cập nhật trạng thái
    if (body.companyId) {
      await db.company.update({ where: { id: body.companyId }, data: { outreachStatus: "DO_NOT_CONTACT" } });
    }
    await audit({ action: "suppression.added", entityType: "SuppressionEntry", entityId: body.companyId ?? null, detail: { identifiers: count, scope: body.scope } });
    return ok({ added: count }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

const DeleteSchema = z.object({ id: z.string() });

export async function DELETE(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, DeleteSchema);
    const entry = await db.suppressionEntry.findUnique({ where: { id: body.id } });
    if (!entry) throw new ApiError(404, "NOT_FOUND", "Bản ghi không tồn tại");
    await db.suppressionEntry.delete({ where: { id: body.id } });
    await audit({ action: "suppression.removed", entityType: "SuppressionEntry", entityId: body.id });
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
