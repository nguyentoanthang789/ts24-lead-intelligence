// GET /api/audit — lịch sử thao tác (đã sanitize, không chứa dữ liệu liên hệ)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handleError, getPagination } from "@/server/http";

export async function GET(req: NextRequest) {
  try {
    const { skip, take, page, pageSize } = getPagination(req);
    const action = req.nextUrl.searchParams.get("action");
    const where = action ? { action: { contains: action } } : {};
    const [total, events] = await Promise.all([
      db.auditEvent.count({ where }),
      db.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    ]);
    return ok({ items: events, total, page, pageSize });
  } catch (err) {
    return handleError(err);
  }
}
