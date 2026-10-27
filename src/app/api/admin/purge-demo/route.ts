// POST /api/admin/purge-demo — XÓA SẠCH toàn bộ lead demo (chỉ giữ lead thật)
import { NextRequest } from "next/server";
import { ok, handleError, requireMutationAuth } from "@/server/http";
import { purgeDemoData } from "@/server/seed";

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const result = await purgeDemoData();
    return ok({ message: "Đã xóa toàn bộ lead demo — hệ thống chỉ còn lead thật", ...result });
  } catch (err) {
    return handleError(err);
  }
}
