// PATCH /api/sources/[id] — cập nhật nguồn (bật/tắt, chính sách, ghi chú xác minh)
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { audit } from "@/server/compliance";

const PatchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  url: z.string().url().optional().or(z.literal("")),
  allowedScope: z.string().nullable().optional(),
  accessPolicy: z.enum(["ALLOWED", "REVIEW_REQUIRED", "DISALLOWED"]).optional(),
  rateLimitPerMin: z.coerce.number().int().min(1).max(60).optional(),
  dataRightsNote: z.string().nullable().optional(),
  retentionDays: z.coerce.number().int().min(30).max(3650).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutationAuth(req);
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const source = await db.source.findUnique({ where: { id } });
    if (!source) throw new ApiError(404, "NOT_FOUND", "Nguồn không tồn tại");

    // NGUYÊN TẮC COMPLIANCE: không bật nguồn khi chưa qua xem xét hoặc bị cấm
    if (body.isActive === true) {
      if (source.accessPolicy !== "ALLOWED") {
        throw new ApiError(400, "POLICY", `Không thể bật thu thập: accessPolicy=${source.accessPolicy}. Cần xác minh quyền sử dụng dữ liệu và robots.txt trước.`);
      }
      if (source.robotsStatus === "RESTRICTED" || source.robotsStatus === "CHECK_FAILED") {
        throw new ApiError(400, "POLICY", `Không thể bật thu thập: robotsStatus=${source.robotsStatus}`);
      }
      if (needsNetworkCheck(source.type) && !source.robotsStatus) {
        throw new ApiError(400, "POLICY", "Chưa kiểm tra khả năng truy cập/robots.txt — hãy bấm 'Kiểm tra nguồn' trước khi bật");
      }
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.url !== undefined) data.url = body.url || null;
    if (body.allowedScope !== undefined) data.allowedScope = body.allowedScope;
    if (body.accessPolicy !== undefined) data.accessPolicy = body.accessPolicy;
    if (body.rateLimitPerMin !== undefined) data.rateLimitPerMin = body.rateLimitPerMin;
    if (body.dataRightsNote !== undefined) data.dataRightsNote = body.dataRightsNote;
    if (body.retentionDays !== undefined) data.retentionDays = body.retentionDays;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.accessPolicy !== undefined && body.accessPolicy !== "ALLOWED") data.isActive = false;

    const updated = await db.source.update({ where: { id }, data });
    await audit({ action: "source.updated", entityType: "Source", entityId: id, detail: { fields: Object.keys(data), isActive: updated.isActive } });
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}

function needsNetworkCheck(type: string): boolean {
  return ["OFFICIAL_API", "OFFICIAL_REGISTRY", "COMPANY_WEBSITE", "PUBLIC_DIRECTORY"].includes(type);
}
