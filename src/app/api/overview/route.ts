// GET /api/overview — thống kê dashboard (chỉ hiển thị số liệu có dữ liệu nền)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handleError } from "@/server/http";
import { getScoringConfig } from "@/server/settings";

export async function GET(_req: NextRequest) {
  try {
    const config = await getScoringConfig();
    const [
      totalCompanies, tierGroups, statusGroups, products, sources,
      recentEvents, gapsSourceCount, recordGroups,
    ] = await Promise.all([
      db.company.count(),
      db.company.groupBy({ by: ["priorityTier"], _count: { _all: true } }),
      db.company.groupBy({ by: ["outreachStatus"], _count: { _all: true } }),
      db.product.findMany({ orderBy: { sortOrder: "asc" } }),
      db.source.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, type: true, isActive: true, accessPolicy: true, lastRunAt: true } }),
      db.outreachEvent.findMany({
        orderBy: { occurredAt: "desc" }, take: 10,
        select: { id: true, type: true, companyId: true, occurredAt: true, note: true, company: { select: { name: true } } },
      }),
      db.source.count({ where: { accessPolicy: "REVIEW_REQUIRED" } }),
      db.sourceRecord.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    const tiers: Record<string, number> = {};
    for (const g of tierGroups) tiers[g.priorityTier] = g._count._all;
    const statuses: Record<string, string | number> = {};
    for (const g of statusGroups) statuses[g.outreachStatus] = g._count._all;

    const productStats: { code: string; name: string; description: string | null; fitCount: number; avgFitScore: number }[] = [];
    for (const p of products) {
      const fits = await db.productFit.aggregate({
        where: { productCode: p.code, fitScore: { gte: config.productCriteria[p.code as "A"]?.minFitScore ?? 50 } },
        _count: { _all: true },
        _avg: { fitScore: true },
      });
      productStats.push({
        code: p.code,
        name: p.name,
        description: p.description,
        fitCount: fits._count._all,
        avgFitScore: Math.round(fits._avg.fitScore ?? 0),
      });
    }

    const rec = (s: string) => recordGroups.find((r) => r.status === s)?._count._all ?? 0;

    return ok({
      hasData: totalCompanies > 0,
      totals: {
        companies: totalCompanies,
        highPriority: tiers["HIGH"] ?? 0,
        needsVerification: tiers["NEEDS_VERIFICATION"] ?? 0,
        low: tiers["LOW"] ?? 0,
        notSuitable: tiers["NOT_SUITABLE"] ?? 0,
      },
      outreachFunnel: statuses,
      productStats,
      sources: sources.map((s) => ({
        ...s,
        status: !s.isActive ? "NOT_ACTIVE" : s.accessPolicy === "REVIEW_REQUIRED" ? "REVIEW" : "READY",
      })),
      sourcesNeedingReview: gapsSourceCount,
      recentEvents: recentEvents.map((e) => ({
        id: e.id, type: e.type, occurredAt: e.occurredAt, note: e.note,
        companyName: e.company.name,
      })),
      records: {
        total: recordGroups.reduce((a, r) => a + r._count._all, 0),
        valid: rec("VALID"),
        duplicate: rec("DUPLICATE"),
        error: rec("ERROR"),
        needsReview: rec("NEEDS_REVIEW"),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
