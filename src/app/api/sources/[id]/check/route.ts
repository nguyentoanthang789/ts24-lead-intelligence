// POST /api/sources/[id]/check — Source Discovery: kiểm tra truy cập + robots.txt + điều khoản
// Không tuyên bố kết nối được nguồn khi chưa kiểm thử thực tế
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handleError, requireMutationAuth, ApiError } from "@/server/http";
import { checkRobots } from "@/server/sources/adapters";
import { audit } from "@/server/compliance";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutationAuth(req);
    const { id } = await params;
    const source = await db.source.findUnique({ where: { id } });
    if (!source) throw new ApiError(404, "NOT_FOUND", "Nguồn không tồn tại");
    if (!source.url) {
      return ok({
        checked: false,
        message: "Nguồn không có URL — loại nguồn này không cần kiểm tra truy cập mạng",
        robotsStatus: source.robotsStatus,
      });
    }

    const robots = await checkRobots(source.url);
    await db.source.update({
      where: { id },
      data: { robotsStatus: robots.status, robotsNote: robots.note },
    });
    await audit({ action: "source.checked", entityType: "Source", entityId: id, detail: { robotsStatus: robots.status } });

    //Khả năng truy cập HTTP cơ bản
    let httpReachable: boolean | null = null;
    let httpNote = "";
    try {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(10000) });
      httpReachable = res.ok;
      httpNote = `HTTP ${res.status}`;
    } catch (err) {
      httpReachable = false;
      httpNote = `Không truy cập được: ${err instanceof Error ? err.message : "lỗi mạng"}`;
    }

    const messages: string[] = [robots.note, httpNote];
    if (source.accessPolicy === "REVIEW_REQUIRED") {
      messages.push("Nguồn đang ở trạng thái REVIEW_REQUIRED — hãy xác minh điều khoản sử dụng dữ liệu trước khi chuyển sang ALLOWED và bật thu thập.");
    }
    return ok({
      checked: true,
      robotsStatus: robots.status,
      robotsNote: robots.note,
      httpReachable,
      message: messages.filter(Boolean).join(" | "),
    });
  } catch (err) {
    return handleError(err);
  }
}
