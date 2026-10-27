// POST /api/score — chạy lại chấm điểm (toàn bộ hoặc 1 công ty), có versioning
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth } from "@/server/http";
import { getScoringConfig } from "@/server/settings";
import { rescoreCompanies } from "@/server/import-pipeline";
import { audit } from "@/server/compliance";

const BodySchema = z.object({ companyId: z.string().optional() });

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, BodySchema);
    const config = await getScoringConfig();
    let companyIds: string[];
    if (body.companyId) {
      companyIds = [body.companyId];
    } else {
      const companies = await db.company.findMany({ select: { id: true } });
      companyIds = companies.map((c) => c.id);
    }
    await rescoreCompanies(companyIds, config);
    await audit({ action: "score.rerun", entityType: "LeadScore", detail: { companies: companyIds.length, ruleVersion: `v${config.version}` } });
    return ok({ scored: companyIds.length, ruleVersion: `v${config.version}` });
  } catch (err) {
    return handleError(err);
  }
}
