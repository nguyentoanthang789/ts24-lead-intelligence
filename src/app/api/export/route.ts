// GET /api/export — xuất CSV theo bộ lọc hiện hành (companies hoặc outreach)
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handleError, parseQuery } from "@/server/http";
import { maskContactValue } from "@/server/compliance";
import { toCsv } from "@/server/csv";

const QuerySchema = z.object({
  view: z.enum(["companies", "outreach"]).default("companies"),
  q: z.string().optional(),
  province: z.string().optional(),
  sector: z.string().optional(),
  product: z.string().optional(),
  tier: z.string().optional(),
  status: z.string().optional(),
  sourceId: z.string().optional(),
  verification: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const query = parseQuery(req, QuerySchema);
    const where: Record<string, unknown> = {};
    if (query.q) where.OR = [{ name: { contains: query.q } }, { taxCode: { contains: query.q.replace(/\D/g, "") } }];
    if (query.province) where.province = query.province;
    if (query.sector) where.sector = { contains: query.sector };
    if (query.tier) where.priorityTier = query.tier;
    if (query.status) where.outreachStatus = query.status;
    if (query.verification) where.verificationStatus = query.verification;
    if (query.sourceId) where.sourceRecords = { some: { sourceId: query.sourceId } };
    if (query.product) where.productFits = { some: { productCode: query.product } };

    if (query.view === "outreach") {
      const tasks = await db.outreachTask.findMany({
        where: { company: where as never },
        take: 5000,
        include: { company: { select: { name: true, taxCode: true, province: true } } },
        orderBy: { updatedAt: "desc" },
      });
      const csv = toCsv(
        ["task_id", "company_name", "tax_code", "province", "status", "scheduled_at", "updated_at", "notes"],
        tasks.map((t) => [t.id, t.company.name, t.company.taxCode ?? "", t.company.province ?? "", t.status, t.scheduledAt?.toISOString() ?? "", t.updatedAt.toISOString(), t.notes ?? ""])
      );
      return new Response(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="ts24-outreach.csv"' },
      });
    }

    const companies = await db.company.findMany({
      where,
      take: 5000,
      include: {
        contactPoints: true,
        productFits: { orderBy: { fitScore: "desc" }, take: 1 },
        leadScores: { orderBy: { computedAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
    });

    // Lưu ý bảo mật: cột phone/email được mask trong bản export mặc định
    // (bản đầy đủ yêu cầu quyền vận hành — xem README mục bảo mật)
    const csv = toCsv(
      ["company_id", "name", "tax_code", "province", "sector", "domain", "top_product", "fit_score", "total_score", "tier", "verification", "contact_masked", "updated_at"],
      companies.map((c) => [
        c.id, c.name, c.taxCode ?? "", c.province ?? "", c.sector ?? "", c.domain ?? "",
        c.productFits[0]?.productCode ?? "", c.productFits[0]?.fitScore ?? 0,
        c.leadScores[0]?.totalScore ?? 0, c.priorityTier, c.verificationStatus,
        c.contactPoints.map((p) => maskContactValue(p.normalized)).join(" | "),
        c.updatedAt.toISOString(),
      ])
    );
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="ts24-companies.csv"' },
    });
  } catch (err) {
    return handleError(err);
  }
}
