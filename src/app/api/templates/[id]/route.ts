// PATCH/DELETE /api/templates/[id]
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { audit } from "@/server/compliance";

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  productCode: z.string().nullable().optional(),
  body: z.string().min(10).max(2000).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutationAuth(req);
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const existing = await db.messageTemplate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Mẫu không tồn tại");
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.productCode !== undefined) data.productCode = body.productCode;
    if (body.body !== undefined) data.body = body.body;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    const template = await db.messageTemplate.update({ where: { id }, data });
    await audit({ action: "template.updated", entityType: "MessageTemplate", entityId: id, detail: { fields: Object.keys(data) } });
    return ok(template);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutationAuth(req);
    const { id } = await params;
    const existing = await db.messageTemplate.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Mẫu không tồn tại");
    await db.messageTemplate.delete({ where: { id } });
    await audit({ action: "template.deleted", entityType: "MessageTemplate", entityId: id });
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err);
  }
}
