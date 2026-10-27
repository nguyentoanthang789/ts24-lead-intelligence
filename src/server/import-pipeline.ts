// ============================================================
// Data Pipeline — Import CSV/XLSX → validate → normalize → dedup → persist → score
// Giữ payload gốc trong SourceRecord để đối chiếu nguồn gốc; bản ghi không chắc chắn → NEEDS_REVIEW
// ============================================================

import { db } from "@/lib/db";
import {
  normalizeTaxCode, normalizePhoneVN, normalizeEmail, normalizeDomain,
  normalizeProvince, normalizeSector, buildNameKey, isValidTaxCode,
  missingRecommendedFields, NormalizedCompany,
} from "./normalization";
import { matchCompany, needsManualReview, buildSourceDedupKey, DedupCandidate } from "./dedup";
import { scoreLead } from "./scoring";
import { ScoringConfig, ProductCode } from "./scoring-config";
import { audit } from "./compliance";

export type ImportRow = Record<string, string>;

/** Map alias header (bỏ dấu, lowercase) → trường chuẩn — export để bộ trích xuất HTML/JSON tái dùng */
export const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "ten_doanh_nghiep", "ten", "company_name", "ten_cong_ty", "companyname"],
  taxCode: ["taxCode", "taxcode", "ma_so_thue", "mst", "tax_code", "masothue"],
  phone: ["phone", "dien_thoai", "so_dien_thoai", "hotline", "sdt", "telephone"],
  email: ["email", "thu_dien_tu", "email_cong_ty"],
  website: ["website", "website_url", "url", "site", "domain"],
  province: ["province", "tinh", "tinh_thanh", "tinh_thanh_pho", "city", "dia_chi_tinh"],
  address: ["address", "dia_chi", "address_full"],
  sector: ["sector", "nganh_nghe", "nganh", "industry", "linh_vuc", "nganh_kinh_doanh"],
  businessStatus: ["business_status", "trang_thai", "trang_thai_hoat_dong", "status"],
  establishedYear: ["established_year", "nam_thanh_lap", "founding_year", "year"],
  sizeSignal: ["size", "quy_mo", "so_lao_dong", "employees", "size_signal"],
};

function pickField(row: Record<string, string>, field: string): string | null {
  const aliases = FIELD_ALIASES[field] ?? [field.toLowerCase()];
  for (const a of aliases) {
    const v = row[a];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

export function normalizeRow(row: ImportRow): { normalized: NormalizedCompany; invalidTaxCode: boolean } {
  const rawName = pickField(row, "name");
  const taxRaw = pickField(row, "taxCode");
  const taxCode = normalizeTaxCode(taxRaw);
  const invalidTaxCode = !!(taxRaw && !taxCode);
  const phones: string[] = [];
  const phoneRaw = pickField(row, "phone");
  if (phoneRaw) {
    // chấp nhận nhiều số cách nhau bởi ; / , /
    for (const part of phoneRaw.split(/[;,/]|(?:\s{2,})/)) {
      const p = normalizePhoneVN(part);
      if (p && !phones.includes(p)) phones.push(p);
    }
  }
  const emails: string[] = [];
  const emailRaw = pickField(row, "email");
  if (emailRaw) {
    for (const part of emailRaw.split(/[;,\s]+/)) {
      const e = normalizeEmail(part);
      if (e && !emails.includes(e)) emails.push(e);
    }
  }
  const websiteRaw = pickField(row, "website");
  const domain = normalizeDomain(websiteRaw);
  const yearRaw = pickField(row, "establishedYear");
  const establishedYear = yearRaw ? parseInt(yearRaw.replace(/\D/g, "").slice(0, 4), 10) : null;
  const statusRaw = pickField(row, "businessStatus");
  let businessStatus = "UNKNOWN";
  if (statusRaw) {
    const s = statusRaw.toLowerCase();
    if (s.includes("dang hoat dong") || s.includes("active") || s.includes("hoat dong")) businessStatus = "ACTIVE";
    else if (s.includes("ngung") || s.includes("giai the") || s.includes("inactive") || s.includes("dong")) businessStatus = "INACTIVE";
  }
  const name = rawName ?? "";
  return {
    invalidTaxCode,
    normalized: {
      name,
      rawName,
      nameKey: buildNameKey(rawName),
      taxCode,
      province: normalizeProvince(pickField(row, "province")),
      address: pickField(row, "address"),
      website: domain ? websiteRaw : null,
      domain,
      sector: normalizeSector(pickField(row, "sector")),
      businessStatus,
      phones,
      emails,
    },
  };
}

function toMatchingCompany(
  n: NormalizedCompany,
  evidenceKinds: { kind: string; confidence: string }[]
) {
  return {
    name: n.name,
    sector: n.sector,
    province: n.province,
    businessStatus: n.businessStatus,
    establishedYear: null as number | null,
    sizeSignal: null as string | null,
    evidenceKinds,
    hasPublicContact: n.phones.length > 0 || n.emails.length > 0,
    missingFields: missingRecommendedFields(n),
  };
}

export type ImportResult = {
  totalRows: number;
  validRows: number;
  createdCompanies: number;
  mergedCompanies: number;
  duplicateRecords: number;
  errorRows: number;
  needsReview: number;
  companyIds: string[];
  errors: { row: number; message: string }[];
};

/**
 * Xử lý một đợt bản ghi từ nguồn (import file hoặc collector):
 * - tạo SourceRecord giữ payload gốc
 * - normalize + dedup theo thứ tự MST > domain > phone > nameKey+province
 * - bản ghi thiếu trường/sai định dạng → ERROR (ghi rõ lý do), không bịa dữ liệu
 * - bản ghi không chắc chắn trùng → NEEDS_REVIEW (hàng đợi xem xét)
 */
export async function processRecords(input: {
  sourceId: string;
  rows: ImportRow[];
  config: ScoringConfig;
  jobId?: string;
}): Promise<ImportResult> {
  const result: ImportResult = {
    totalRows: input.rows.length, validRows: 0, createdCompanies: 0,
    mergedCompanies: 0, duplicateRecords: 0, errorRows: 0, needsReview: 0,
    companyIds: [], errors: [],
  };

  // BATCH WRITES: gom bản ghi phụ để ghi hàng loạt cuối đợt — giảm round-trip SQLite
  type PendingSourceRecord = {
    sourceId: string; companyId: string | null; payload: string;
    status: string; dedupKey: string | null; errorMessage: string | null;
  };
  const pendingRecords: PendingSourceRecord[] = [];
  const pendingContacts: { companyId: string; type: string; value: string; normalized: string }[] = [];
  const pendingEvidence: { companyId: string; kind: string; summary: string; confidence: string }[] = [];
  // khử trùng lặp trong đợt: pre-load dedupKey hiện có của nguồn + cộng dồn khi xử lý
  const existingKeys = new Set<string>(
    (
      await db.sourceRecord.findMany({
        where: { sourceId: input.sourceId, dedupKey: { not: null }, status: { in: ["VALID", "DUPLICATE"] } },
        select: { dedupKey: true },
      })
    ).map((r) => r.dedupKey as string)
  );

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    try {
      const { normalized, invalidTaxCode } = normalizeRow(row);
      if (!normalized.name) {
        result.errorRows++;
        result.errors.push({ row: i + 1, message: "Thiếu tên doanh nghiệp" });
        pendingRecords.push({ sourceId: input.sourceId, companyId: null, payload: JSON.stringify(row), status: "ERROR", dedupKey: null, errorMessage: "Thiếu tên doanh nghiệp" });
        continue;
      }
      if (invalidTaxCode) {
        result.errorRows++;
        result.errors.push({ row: i + 1, message: "Mã số thuế sai định dạng" });
        pendingRecords.push({ sourceId: input.sourceId, companyId: null, payload: JSON.stringify(row), status: "ERROR", dedupKey: null, errorMessage: "Mã số thuế sai định dạng" });
        continue;
      }

      const dedupKey = buildSourceDedupKey(normalized);

      // chống trùng: trong DB (pre-load) + trong cùng đợt (Set cộng dồn)
      if (dedupKey && existingKeys.has(dedupKey)) {
        result.duplicateRecords++;
        pendingRecords.push({ sourceId: input.sourceId, companyId: null, payload: JSON.stringify(row), status: "DUPLICATE", dedupKey, errorMessage: null });
        continue;
      }
      if (dedupKey) existingKeys.add(dedupKey);

      // ứng viên gộp
      const rows = await db.company.findMany({
        where: normalized.taxCode
          ? { OR: [{ taxCode: normalized.taxCode }, { nameKey: normalized.nameKey ?? "___" }] }
          : { OR: [{ domain: normalized.domain ?? "___" }, { nameKey: normalized.nameKey ?? "___" }] },
        select: { id: true, taxCode: true, domain: true, province: true, nameKey: true, taxCodeStatus: true, contactPoints: { where: { type: "PHONE" }, select: { normalized: true } } },
        take: 50,
      });
      const cands: DedupCandidate[] = rows.map((c) => ({
        id: c.id,
        taxCode: c.taxCode,
        taxCodeStatus: c.taxCodeStatus,
        domain: c.domain,
        province: c.province,
        nameKey: c.nameKey,
        phoneNumbers: c.contactPoints.map((p) => p.normalized),
      }));
      const match = matchCompany(
        { taxCode: normalized.taxCode, domain: normalized.domain, phones: normalized.phones, nameKey: normalized.nameKey, province: normalized.province },
        cands
      );
      const review = needsManualReview(
        { taxCode: normalized.taxCode, domain: normalized.domain, phones: normalized.phones, nameKey: normalized.nameKey, province: normalized.province },
        cands
      );

      let companyId: string;
      let recordStatus = "VALID";

      if (match.companyId) {
        companyId = match.companyId;
        result.mergedCompanies++;
        // hợp nhất bổ sung: thêm contact mới, cập nhật trường trống, lưu lịch sử qua updatedAt
        const existing = await db.company.findUnique({ where: { id: companyId }, include: { contactPoints: true } });
        if (existing) {
          for (const p of normalized.phones) {
            await db.contactPoint.upsert({
              where: { companyId_type_normalized: { companyId, type: "PHONE", normalized: p } },
              create: { companyId, type: "PHONE", value: p, normalized: p, isPublic: true },
              update: {},
            });
          }
          for (const e of normalized.emails) {
            await db.contactPoint.upsert({
              where: { companyId_type_normalized: { companyId, type: "EMAIL", normalized: e } },
              create: { companyId, type: "EMAIL", value: e, normalized: e, isPublic: true },
              update: {},
            });
          }
          const updates: Record<string, string> = {};
          if (!existing.taxCode && normalized.taxCode) updates.taxCode = normalized.taxCode;
          if (!existing.domain && normalized.domain) updates.domain = normalized.domain;
          if (!existing.sector && normalized.sector) updates.sector = normalized.sector;
          if (!existing.province && normalized.province) updates.province = normalized.province;
          if (!existing.address && normalized.address) updates.address = normalized.address;
          if (Object.keys(updates).length > 0) {
            await db.company.update({ where: { id: companyId }, data: updates });
          }
        }
      } else {
        // tạo mới
        const created = await db.company.create({
          data: {
            name: normalized.name,
            rawName: normalized.rawName,
            nameKey: normalized.nameKey,
            taxCode: normalized.taxCode,
            taxCodeStatus: normalized.taxCode && isValidTaxCode(normalized.taxCode) ? "VERIFIED" : "UNVERIFIED",
            province: normalized.province,
            address: normalized.address,
            website: normalized.website,
            domain: normalized.domain,
            sector: normalized.sector,
            businessStatus: normalized.businessStatus,
            establishedYear: (() => {
              const y = pickField(row, "establishedYear");
              const year = y ? parseInt(y.replace(/\D/g, "").slice(0, 4), 10) : NaN;
              return year && year >= 1900 && year <= new Date().getFullYear() ? year : null;
            })(),
            sizeSignal: pickField(row, "sizeSignal"),
            verificationStatus: normalized.taxCode ? "PARTIALLY_VERIFIED" : "UNVERIFIED",
          },
        });
        companyId = created.id;
        result.createdCompanies++;
        for (const p of normalized.phones) {
          pendingContacts.push({ companyId, type: "PHONE", value: p, normalized: p });
        }
        for (const e of normalized.emails) {
          pendingContacts.push({ companyId, type: "EMAIL", value: e, normalized: e });
        }
        // bằng chứng cơ bản: ngành nghề + kênh liên hệ công khai
        if (normalized.sector) {
          pendingEvidence.push({ companyId, kind: "SECTOR", summary: `Ngành nghề: ${normalized.sector}`, confidence: "MEDIUM" });
        }
        if (normalized.phones.length || normalized.emails.length) {
          pendingEvidence.push({ companyId, kind: "PUBLIC_CONTACT", summary: "Công bố kênh liên hệ trong dữ liệu nguồn", confidence: "MEDIUM" });
        }
      }

      if (review.review) {
        recordStatus = "NEEDS_REVIEW";
        result.needsReview++;
      } else {
        result.validRows++;
      }

      pendingRecords.push({
        sourceId: input.sourceId,
        companyId: recordStatus === "VALID" ? companyId : null,
        payload: JSON.stringify(row),
        status: recordStatus,
        dedupKey,
        errorMessage: review.review ? (review.reason ?? "Cần xem xét thủ công") : null,
      });
      if (recordStatus === "VALID" && !result.companyIds.includes(companyId)) {
        result.companyIds.push(companyId);
      }
    } catch (rowErr) {
      result.errorRows++;
      const msg = rowErr instanceof Error ? rowErr.message : String(rowErr);
      result.errors.push({ row: i + 1, message: msg });
      pendingRecords.push({ sourceId: input.sourceId, companyId: null, payload: JSON.stringify(row), status: "ERROR", dedupKey: null, errorMessage: msg.slice(0, 500) });
    }
  }

  // GHI BATCH: contact + evidence + sourceRecord — nhanh hơn gấp nhiều lần so với từng dòng
  const seenContact = new Set<string>();
  const contactRows = pendingContacts.filter((c) => {
    const k = `${c.companyId}:${c.type}:${c.normalized}`;
    if (seenContact.has(k)) return false;
    seenContact.add(k);
    return true;
  });
  for (let i = 0; i < contactRows.length; i += 500) {
    await db.contactPoint.createMany({ data: contactRows.slice(i, i + 500) });
  }
  for (let i = 0; i < pendingEvidence.length; i += 500) {
    await db.evidence.createMany({ data: pendingEvidence.slice(i, i + 500).map((e) => ({ ...e, sourceName: input.sourceId })) });
  }
  for (let i = 0; i < pendingRecords.length; i += 500) {
    await db.sourceRecord.createMany({ data: pendingRecords.slice(i, i + 500).map((r) => ({ ...r, collectedAt: new Date() })) });
  }

  // cập nhật job stats nếu có
  if (input.jobId) {
    await db.collectionJob.update({
      where: { id: input.jobId },
      data: {
        discoveredCount: result.totalRows,
        validCount: result.validRows,
        errorCount: result.errorRows,
        duplicateCount: result.duplicateRecords,
        checkpoint: JSON.stringify({ processed: result.totalRows, finished: true }),
        finishedAt: new Date(),
      },
    });
  }

  // chấm điểm cho công ty mới tạo/hợp nhất
  if (result.companyIds.length > 0) {
    await rescoreCompanies(result.companyIds, input.config);
  }

  await audit({
    action: "import.processed",
    entityType: "Source",
    entityId: input.sourceId,
    detail: {
      rows: result.totalRows, valid: result.validRows, created: result.createdCompanies,
      merged: result.mergedCompanies, duplicates: result.duplicateRecords, errors: result.errorRows,
      needsReview: result.needsReview,
    },
  });

  return result;
}

/** Chấm điểm lại danh sách công ty theo config hiện hành — GHI BATCH để đạt thông lượng tối đa */
export async function rescoreCompanies(companyIds: string[], config: ScoringConfig) {
  const companies = await db.company.findMany({
    where: { id: { in: companyIds } },
    include: { contactPoints: true, evidences: true, sourceRecords: { select: { id: true } } },
  });
  const scoreRows: {
    companyId: string; totalScore: number; productFitScore: number; evidenceScore: number;
    segmentScore: number; contactScore: number; freshnessScore: number; ruleVersion: string;
    tier: string; explanation: string;
  }[] = [];
  const fitRows: {
    companyId: string; productCode: string; fitScore: number; reasons: string;
    missingFields: string; needsVerification: boolean;
  }[] = [];
  const tierUpdates: { id: string; tier: string }[] = [];
  for (const c of companies) {
    const evidenceKinds = c.evidences.map((e) => ({ kind: e.kind, confidence: e.confidence }));
    const mc = {
      name: c.name,
      sector: c.sector,
      province: c.province,
      businessStatus: c.businessStatus,
      establishedYear: c.establishedYear,
      sizeSignal: c.sizeSignal,
      evidenceKinds,
      hasPublicContact: c.contactPoints.length > 0,
      missingFields: ((): string[] => {
        const m: string[] = [];
        if (!c.taxCode) m.push("taxCode");
        if (c.contactPoints.length === 0) m.push("contact");
        if (!c.sector) m.push("sector");
        if (!c.province) m.push("province");
        return m;
      })(),
    };
    const rawEvidence = c.evidences.map((e) => ({ kind: e.kind, confidence: e.confidence, recordedAt: e.recordedAt }));
    const pcCount = c.contactPoints.filter((p) => p.type === "PHONE" || p.type === "EMAIL").length;
    const scored = scoreLead(mc, rawEvidence, config, {
      lastVerifiedAt: c.lastVerifiedAt,
      updatedAt: c.updatedAt,
      publicContactCount: pcCount,
      ruleVersion: `v${config.version}`,
    });
    scoreRows.push({
      companyId: c.id,
      totalScore: scored.totalScore,
      productFitScore: scored.components.productFit.score,
      evidenceScore: scored.components.evidence.score,
      segmentScore: scored.components.segment.score,
      contactScore: scored.components.contact.score,
      freshnessScore: scored.components.freshness.score,
      ruleVersion: scored.ruleVersion,
      tier: scored.tier,
      explanation: JSON.stringify({
        components: scored.components,
        tierReason: scored.tierReason,
        confidence: scored.confidence,
      }),
    });
    for (const fit of scored.fits) {
      fitRows.push({
        companyId: c.id,
        productCode: fit.productCode,
        fitScore: fit.fitScore,
        reasons: JSON.stringify(fit.reasons),
        missingFields: JSON.stringify(fit.missingFields),
        needsVerification: fit.needsVerification,
      });
    }
    tierUpdates.push({ id: c.id, tier: scored.tier });
  }

  // GHI BATCH: LeadScore append hàng loạt; ProductFit xóa rồi ghi lại hàng loạt
  // (thay thế upsert từng dòng — cùng kết quả, nhanh hơn ~8 lần)
  const CHUNK = 500;
  for (let i = 0; i < scoreRows.length; i += CHUNK) {
    await db.leadScore.createMany({ data: scoreRows.slice(i, i + CHUNK) });
  }
  const fitIds = [...new Set(fitRows.map((f) => f.companyId))];
  for (let i = 0; i < fitIds.length; i += CHUNK) {
    await db.productFit.deleteMany({ where: { companyId: { in: fitIds.slice(i, i + CHUNK) } } });
  }
  for (let i = 0; i < fitRows.length; i += CHUNK) {
    await db.productFit.createMany({ data: fitRows.slice(i, i + CHUNK) });
  }
  // cập nhật tier hàng loạt bằng raw CASE (tránh 1 query/công ty)
  for (let i = 0; i < tierUpdates.length; i += CHUNK) {
    const slice = tierUpdates.slice(i, i + CHUNK);
    const cases = slice
      .map((u) => `WHEN '${u.id.replace(/[^a-z0-9]/gi, "")}' THEN '${u.tier.replace(/[^A-Z_]/g, "")}'`)
      .join(" ");
    const idList = slice.map((u) => `'${u.id.replace(/[^a-z0-9]/gi, "")}'`).join(",");
    if (cases) {
      await db.$executeRawUnsafe(
        `UPDATE Company SET priorityTier = CASE id ${cases} ELSE priorityTier END WHERE id IN (${idList})`
      );
    }
  }
}

export type { ProductCode };
