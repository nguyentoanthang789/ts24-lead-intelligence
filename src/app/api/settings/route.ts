// GET/PUT /api/settings — cấu hình chấm điểm (versioned), danh sách sản phẩm, sender_name
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { getScoringConfig, saveScoringConfig } from "@/server/settings";
import { DEFAULT_SCORING_CONFIG } from "@/server/scoring-config";

export async function GET() {
  try {
    const config = await getScoringConfig();
    const products = await db.product.findMany({ orderBy: { sortOrder: "asc" } });
    const senderName = (await db.appSetting.findUnique({ where: { key: "sender_name" } }))?.value ?? "";
    return ok({ config, products, senderName, defaultConfig: DEFAULT_SCORING_CONFIG });
  } catch (err) {
    return handleError(err);
  }
}

const PutSchema = z.object({
  weights: z.object({
    productFit: z.coerce.number().min(0).max(100),
    evidence: z.coerce.number().min(0).max(100),
    segment: z.coerce.number().min(0).max(100),
    contact: z.coerce.number().min(0).max(100),
    freshness: z.coerce.number().min(0).max(100),
  }),
  tierThresholds: z.object({
    high: z.coerce.number().min(0).max(100),
    needsVerification: z.coerce.number().min(0).max(100),
    low: z.coerce.number().min(0).max(100),
  }),
  freshnessDays: z.coerce.number().min(1).max(365),
  keyProvinces: z.array(z.string()),
  senderName: z.string().max(120).optional(),
});

export async function PUT(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, PutSchema);
    const current = await getScoringConfig();
    const nextConfig = {
      ...current,
      weights: body.weights,
      tierThresholds: body.tierThresholds,
      freshnessDays: body.freshnessDays,
      keyProvinces: body.keyProvinces,
    };
    const result = await saveScoringConfig(nextConfig);
    if (!result.ok) throw new ApiError(400, "VALIDATION", result.errors.join("; "));
    if (body.senderName !== undefined) {
      await db.appSetting.upsert({
        where: { key: "sender_name" },
        create: { key: "sender_name", value: body.senderName },
        update: { value: body.senderName },
      });
    }
    return ok(await getScoringConfig());
  } catch (err) {
    return handleError(err);
  }
}
