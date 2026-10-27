// GET /api/companies/[id] — hồ sơ đầy đủ: nguồn gốc, bằng chứng, lịch sử, điểm
// PATCH /api/companies/[id] — sửa trường dữ liệu (audit)
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { getScoringConfig } from "@/server/settings";
import { rescoreCompanies } from "@/server/import-pipeline";
import { audit } from "@/server/compliance";
import { normalizePhoneVN, normalizeEmail, normalizeDomain, normalizeProvince, normalizeTaxCode, isValidTaxCode } from "@/server/normalization";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const company = await db.company.findUnique({
      where: { id },
      include: {
        contactPoints: true,
        sourceRecords: { select: { id: true, status: true, payload: true, collectedAt: true, errorMessage: true, source: { select: { id: true, name: true, type: true } } } },
        evidences: { orderBy: { recordedAt: "desc" } },
        productFits: { orderBy: { fitScore: "desc" } },
        leadScores: { orderBy: { computedAt: "desc" }, take: 3 },
        outreachTasks: { orderBy: { updatedAt: "desc" } },
        outreachEvents: { orderBy: { occurredAt: "desc" }, take: 50 },
      },
    });
    if (!company) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy doanh nghiệp");
    return ok(company);
  } catch (err) {
    return handleError(err);
  }
}

const PatchSchema = z.object({
  name: z.string().min(2).optional(),
  taxCode: z.string().optional(),
  province: z.string().optional(),
  address: z.string().optional(),
  website: z.string().optional(),
  sector: z.string().optional(),
  businessStatus: z.enum(["ACTIVE", "INACTIVE", "UNKNOWN"]).optional(),
  sizeSignal: z.string().optional(),
  establishedYear: z.coerce.number().int().min(1900).max(new Date().getFullYear()).nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  addPhone: z.string().optional(),
  addEmail: z.string().optional(),
  addEvidence: z.object({
    kind: z.string(),
    summary: z.string().min(3),
    sourceUrl: z.string().url().optional().or(z.literal("")),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  }).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutationAuth(req);
    const { id } = await params;
    const body = await parseBody(req, PatchSchema);
    const existing = await db.company.findUnique({ where: { id }, include: { contactPoints: true } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy doanh nghiệp");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.taxCode !== undefined) {
      const tc = normalizeTaxCode(body.taxCode);
      if (body.taxCode && !tc) throw new ApiError(400, "VALIDATION", "Mã số thuế sai định dạng");
      data.taxCode = tc;
      data.taxCodeStatus = tc ? (isValidTaxCode(tc) ? "VERIFIED" : "UNVERIFIED") : "UNVERIFIED";
    }
    if (body.province !== undefined) data.province = normalizeProvince(body.province);
    if (body.address !== undefined) data.address = body.address;
    if (body.website !== undefined) {
      data.website = body.website || null;
      data.domain = body.website ? normalizeDomain(body.website) : null;
    }
    if (body.sector !== undefined) data.sector = body.sector ? body.sector.toLowerCase() : null;
    if (body.businessStatus !== undefined) data.businessStatus = body.businessStatus;
    if (body.sizeSignal !== undefined) data.sizeSignal = body.sizeSignal;
    if (body.establishedYear !== undefined) data.establishedYear = body.establishedYear;
    if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes;

    await db.company.update({ where: { id }, data });

    // thêm kênh liên hệ
    if (body.addPhone) {
      const p = normalizePhoneVN(body.addPhone);
      if (!p) throw new ApiError(400, "VALIDATION", "Số điện thoại sai định dạng VN");
      await db.contactPoint.upsert({
        where: { companyId_type_normalized: { companyId: id, type: "PHONE", normalized: p } },
        create: { companyId: id, type: "PHONE", value: p, normalized: p, isPublic: true },
        update: {},
      });
    }
    if (body.addEmail) {
      const e = normalizeEmail(body.addEmail);
      if (!e) throw new ApiError(400, "VALIDATION", "Email sai định dạng");
      await db.contactPoint.upsert({
        where: { companyId_type_normalized: { companyId: id, type: "EMAIL", normalized: e } },
        create: { companyId: id, type: "EMAIL", value: e, normalized: e, isPublic: true },
        update: {},
      });
    }
    // thêm bằng chứng (chỉ từ nguồn người dùng khai báo — không bịa)
    if (body.addEvidence) {
      await db.evidence.create({
        data: {
          companyId: id,
          kind: body.addEvidence.kind,
          summary: body.addEvidence.summary,
          sourceUrl: body.addEvidence.sourceUrl || null,
          sourceName: "manual",
          confidence: body.addEvidence.confidence,
        },
      });
    }

    // rescore sau chỉnh sửa
    const config = await getScoringConfig();
    await rescoreCompanies([id], config);
    await audit({ action: "company.updated", entityType: "Company", entityId: id, detail: { fields: Object.keys(data), addedEvidence: !!body.addEvidence, addedContact: !!(body.addPhone || body.addEmail) } });

    const company = await db.company.findUnique({
      where: { id },
      include: {
        contactPoints: true,
        evidences: { orderBy: { recordedAt: "desc" } },
        productFits: { orderBy: { fitScore: "desc" } },
        leadScores: { orderBy: { computedAt: "desc" }, take: 3 },
      },
    });
    return ok(company);
  } catch (err) {
    return handleError(err);
  }
}
