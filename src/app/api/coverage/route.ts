// GET /api/coverage — báo cáo độ bao phủ (không tạo tỷ lệ giả)
import { NextRequest } from "next/server";
import { ok, handleError } from "@/server/http";
import { computeCoverage } from "@/server/coverage";
import { getScoringConfig } from "@/server/settings";

export async function GET(_req: NextRequest) {
  try {
    const config = await getScoringConfig();
    const report = await computeCoverage(config);
    return ok(report);
  } catch (err) {
    return handleError(err);
  }
}
