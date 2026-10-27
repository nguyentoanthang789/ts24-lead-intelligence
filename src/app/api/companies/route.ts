// GET /api/companies — Lead Explorer: tìm kiếm/lọc/phân trang phía máy chủ
// POST /api/companies — tạo doanh nghiệp thủ công (Manual Entry)
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, getPagination, parseBody, parseQuery, ApiError, requireMutationAuth } from "@/server/http";
import { getScoringConfig } from "@/server/settings";
import { processRecords } from "@/server/import-pipeline";
import { audit } from "@/server/compliance";

const QuerySchema = z.object({
  q: z.string().optional(),
  province: z.string().optional(),
  sector: z.string().optional(),
  product: z.string().optional(),
  tier: z.string().optional(),
  status: z.string().optional(),
  sourceId: z.string().optional(),
  verification: z.string().optional(),
  minScore: z.coerce.number().optional(),
  sort: z.enum(["score", "recent", "name"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const query = parseQuery(req, QuerySchema);
    const { page, pageSize, skip, take } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (query.q) {
      where.OR = [
        { name: { contains: query.q } },
        { taxCode: { contains: query.q.replace(/\D/g, "") } },
      ];
    }
    if (query.province) where.province = query.province;
    if (query.sector) where.sector = { contains: query.sector };
    if (query.tier) where.priorityTier = query.tier;
    if (query.status) where.outreachStatus = query.status;
    if (query.verification) where.verificationStatus = query.verification;
    if (query.sourceId) where.sourceRecords = { some: { sourceId: query.sourceId } };
    if (query.product) where.productFits = { some: { productCode: query.product } };
    // minScore lọc theo LeadScore mới nhất — dùng ProductFit thay thế phức tạp; MVP: lọc theo tier score qua join
    let orderBy: Record<string, string> = { updatedAt: "desc" };
    if (query.sort === "name") orderBy = { name: "asc" };
    if (query.sort === "score") orderBy = { updatedAt: "desc" }; // sẽ sort sau join điểm

    let companyIdsByScore: string[] | null = null;
    if (query.sort === "score" || query.minScore !== undefined) {
      const scores = await db.leadScore.findMany({
        orderBy: [{ computedAt: "desc" }],
        select: { companyId: true, totalScore: true },
      });
      // lấy điểm mới nhất mỗi công ty
      const latest = new Map<string, number>();
      for (const s of scores) if (!latest.has(s.companyId)) latest.set(s.companyId, s.totalScore);
      companyIdsByScore = [...latest.entries()]
        .filter(([, sc]) => query.minScore === undefined || sc >= query.minScore)
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id);
      if (companyIdsByScore.length === 0) {
        return ok({ items: [], total: 0, page, pageSize });
      }
      where.id = { in: companyIdsByScore.slice(skip, skip + take) };
      const total = query.minScore !== undefined
        ? companyIdsByScore.length
        : await db.company.count({ where });
      const items = await db.company.findMany({
        where,
        include: {
          contactPoints: true,
          productFits: { orderBy: { fitScore: "desc" }, take: 3 },
          leadScores: { orderBy: { computedAt: "desc" }, take: 1 },
          sourceRecords: { select: { sourceId: true, source: { select: { name: true } } }, distinct: ["sourceId"] },
        },
      });
      // giữ thứ tự theo điểm
      const orderMap = new Map(companyIdsByScore.slice(skip, skip + take).map((id, i) => [id, i]));
      items.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      return ok({ items, total, page, pageSize });
    }

    const [total, items] = await Promise.all([
      db.company.count({ where }),
      db.company.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          contactPoints: true,
          productFits: { orderBy: { fitScore: "desc" }, take: 3 },
          leadScores: { orderBy: { computedAt: "desc" }, take: 1 },
          sourceRecords: { select: { sourceId: true, source: { select: { name: true } } }, distinct: ["sourceId"] },
        },
      }),
    ]);
    return ok({ items, total, page, pageSize });
  } catch (err) {
    return handleError(err);
  }
}

const CreateSchema = z.object({
  name: z.string().min(2, "Tên doanh nghiệp tối thiểu 2 ký tự"),
  taxCode: z.string().optional(),
  province: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  sector: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  establishedYear: z.coerce.number().int().min(1900).max(new Date().getFullYear()).optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    // manual entry luôn đi qua pipeline chuẩn để normalize + dedup
    const config = await getScoringConfig();
    let manualSource = await db.source.findUnique({ where: { name: "Nhập thủ công" } });
    if (!manualSource) {
      manualSource = await db.source.create({
        data: { name: "Nhập thủ công", type: "MANUAL_ENTRY", accessPolicy: "ALLOWED", allowedScope: "Doanh nghiệp do nhân viên nhập", isActive: true, needsReview: false, dataRightsNote: "Dữ liệu nhập nội bộ" },
      });
    }
    const row: Record<string, string> = {
      name: body.name,
      ...(body.taxCode ? { taxcode: body.taxCode } : {}),
      ...(body.province ? { province: body.province } : {}),
      ...(body.address ? { address: body.address } : {}),
      ...(body.website ? { website: body.website } : {}),
      ...(body.sector ? { sector: body.sector } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.email ? { email: body.email } : {}),
      ...(body.establishedYear ? { established_year: String(body.establishedYear) } : {}),
    };
    const result = await processRecords({ sourceId: manualSource.id, rows: [row], config });
    if (result.createdCompanies === 0 && result.mergedCompanies === 0 && result.errorRows > 0) {
      throw new ApiError(400, "IMPORT_ERROR", result.errors[0]?.message ?? "Dữ liệu không hợp lệ");
    }
    await audit({ action: "company.manual_created", entityType: "Company", detail: { merged: result.mergedCompanies, created: result.createdCompanies } });
    const companyId = result.companyIds[0] ?? null;
    const company = companyId ? await db.company.findUnique({ where: { id: companyId }, include: { contactPoints: true, leadScores: { orderBy: { computedAt: "desc" }, take: 1 } } }) : null;
    return ok({ import: result, company }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
