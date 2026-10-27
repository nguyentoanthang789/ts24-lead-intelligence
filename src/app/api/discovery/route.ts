// GET /api/discovery — danh mục ứng viên nguồn + trạng thái đăng ký
// POST — tự dò (robots.txt + HTTP) danh mục (+ URL tùy chọn) rồi đăng ký nguồn mới
// Nguồn mới luôn: chờ xem xét + tắt — người dùng xác minh điều khoản rồi mới bật
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { CANDIDATE_SOURCES, probeAndRegister, normalizeSourceUrl } from "@/server/discovery";

export async function GET() {
  try {
    const registered = await db.source.findMany({ select: { url: true, name: true } });
    const regUrls = new Set(registered.map((r) => r.url).filter(Boolean) as string[]);
    return ok({
      catalog: CANDIDATE_SOURCES.map((c) => ({ ...c, alreadyRegistered: regUrls.has(c.url) })),
      registeredCount: registered.length,
    });
  } catch (err) {
    return handleError(err);
  }
}

const BodySchema = z.object({ urls: z.array(z.string()).max(10).optional() });

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, BodySchema);
    const normalized = (body.urls ?? []).map((u) => normalizeSourceUrl(u));
    if (normalized.some((u) => u === null)) {
      throw new ApiError(400, "VALIDATION", "URL không hợp lệ — phải là http/https");
    }
    const results = await probeAndRegister({ urls: normalized as string[] });
    return ok({
      results,
      registered: results.filter((r) => r.registered).length,
      alreadyRegistered: results.filter((r) => r.alreadyRegistered).length,
    });
  } catch (err) {
    return handleError(err);
  }
}
