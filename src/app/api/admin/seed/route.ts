// POST /api/admin/seed — nạp dữ liệu demo tổng hợp (idempotent)
import { NextRequest } from "next/server";
import { ok, handleError, requireMutationAuth } from "@/server/http";
import { seedDemoData } from "@/server/seed";
import { audit } from "@/server/compliance";

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const result = await seedDemoData();
    await audit({ action: "admin.seed", entityType: "System", detail: { rows: result.totalRows, created: result.createdCompanies, merged: result.mergedCompanies } });
    return ok({ message: "Đã nạp dữ liệu demo tổng hợp", ...result });
  } catch (err) {
    return handleError(err);
  }
}
