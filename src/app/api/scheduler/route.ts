// GET  /api/scheduler — trạng thái + cấu hình tự động chạy (lần chạy tới, kết quả gần nhất)
// PUT  /api/scheduler — lưu cấu hình (enabled, runAt, timezone, các bước tự động)
// POST /api/scheduler — chạy pipeline ngay (thủ công, không đợi lịch)
import { NextRequest } from "next/server";
import { z } from "zod";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import {
  getSchedulerStatus,
  saveSchedulerConfig,
  validateSchedulerConfig,
  runScheduledPipeline,
  DEFAULT_SCHEDULER_CONFIG,
  SchedulerConfig,
} from "@/server/scheduler";

export async function GET() {
  try {
    return ok(await getSchedulerStatus());
  } catch (err) {
    return handleError(err);
  }
}

const PutSchema = z.object({
  enabled: z.boolean(),
  runAt: z.string(),
  timezone: z.string(),
  autoDiscover: z.boolean(),
  autoRunSources: z.boolean(),
  autoRescore: z.boolean(),
  retentionCleanup: z.boolean(),
});

export async function PUT(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, PutSchema);
    const v = validateSchedulerConfig(body);
    if (!v.ok) throw new ApiError(400, "VALIDATION", v.errors.join("; "));
    const current = await getSchedulerStatus();
    const next: SchedulerConfig = {
      ...DEFAULT_SCHEDULER_CONFIG,
      ...body,
      lastRunAt: current.config.lastRunAt,
      lastRunDay: current.config.lastRunDay,
    };
    await saveSchedulerConfig(next);
    return ok(await getSchedulerStatus());
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const r = await runScheduledPipeline("manual");
    if (!r.ok) throw new ApiError(409, "BUSY", r.message ?? "Pipeline đang chạy");
    return ok(r);
  } catch (err) {
    return handleError(err);
  }
}
