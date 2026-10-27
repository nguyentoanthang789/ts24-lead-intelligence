// GET  /api/continuous — trạng thái chế độ chạy liên tục (nút START toàn bộ)
// POST { action: "start" | "stop" } — bật/tắt chạy liên tục không nghỉ
// PUT  { intervalMinutes?, autoDiscover?, ... } — cập nhật cấu hình (áp dụng từ vòng kế tiếp)
import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, handleError, parseBody, requireMutationAuth } from "@/server/http";
import {
  getContinuousStatus,
  startContinuous,
  stopContinuous,
  updateContinuousConfig,
} from "@/server/continuous";

export async function GET() {
  try {
    return ok(await getContinuousStatus());
  } catch (err) {
    return handleError(err);
  }
}

const PostSchema = z.object({ action: z.enum(["start", "stop"]) });

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, PostSchema);
    const result =
      body.action === "start" ? await startContinuous() : await stopContinuous();
    const status = await getContinuousStatus();
    return ok({ status, result });
  } catch (err) {
    return handleError(err);
  }
}

const PutSchema = z
  .object({
    intervalMinutes: z.number().optional(),
    autoDiscover: z.boolean().optional(),
    autoRunSources: z.boolean().optional(),
    autoRescore: z.boolean().optional(),
    retentionCleanup: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Cần ít nhất một trường cần cập nhật" });

export async function PUT(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, PutSchema);
    await updateContinuousConfig(body);
    return ok(await getContinuousStatus());
  } catch (err) {
    return handleError(err);
  }
}
