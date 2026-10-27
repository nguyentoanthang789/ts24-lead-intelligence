// GET /api/collector — cấu hình tốc độ thu thập
// PUT /api/collector — cập nhật maxPagesPerSource / sourceConcurrency / requestTimeoutMs
import { NextRequest } from "next/server";
import { ok, handleError, requireMutationAuth, parseBody } from "@/server/http";
import {
  getCollectorConfig,
  saveCollectorConfig,
  validateCollectorConfig,
  CollectorConfig,
} from "@/server/collector-config";
import { z } from "zod";

export async function GET() {
  try {
    const cfg = await getCollectorConfig();
    return ok({ config: cfg });
  } catch (err) {
    return handleError(err);
  }
}

const putSchema = z.object({
  maxPagesPerSource: z.number().int().min(1).max(100).optional(),
  sourceConcurrency: z.number().int().min(1).max(8).optional(),
  requestTimeoutMs: z.number().int().min(5000).max(60000).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const patch = await parseBody(req, putSchema);
    const cur = await getCollectorConfig();
    const merged: CollectorConfig = { ...cur, ...patch };
    const v = validateCollectorConfig(merged);
    if (!v.ok) return ok({ saved: false, errors: v.errors });
    const saved = await saveCollectorConfig(merged);
    return ok({ saved: true, config: saved, errors: [] });
  } catch (err) {
    return handleError(err);
  }
}
