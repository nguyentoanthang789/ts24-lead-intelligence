// ============================================================
// Module 6 — Lead Coverage Engine
// Tính chỉ số theo nguồn / tỉnh / ngành / sản phẩm / trạng thái xác minh / thời gian.
// QUY TẮC: KHÔNG tạo tỷ lệ bao phủ thị trường khi không có mẫu số được tài liệu hóa
// → hiển thị "Chưa xác định mẫu số bao phủ"
// ============================================================

import { db } from "@/lib/db";
import { ScoringConfig, PRODUCT_CODES, ProductCode } from "./scoring-config";

export type CoverageRow = {
  dimension: string;
  key: string;
  discovered: number;
  afterDedup: number;
  validData: number;
  verified: number;
  productFit: Record<string, number>;
  requiredFieldRate: number;
  duplicateRate: number;
  errorRate: number;
  unverifiedRate: number;
  lastCollectedAt: string | null;
  denominator: number | null;
  denominatorSource: string | null;
  coveragePercent: number | null;
  coverageStatus: "CALCULATED" | "DENOMINATOR_UNKNOWN";
};

export type CoverageGap = {
  type: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  suggestion: string;
};

export type CoverageReport = {
  generatedAt: string;
  overall: {
    companies: number;
    validData: number;
    verified: number;
    highPriority: number;
    needsVerification: number;
    sourceRecords: number;
    duplicateRecords: number;
    errorRecords: number;
    needsReviewRecords: number;
    requiredFieldRate: number;
    duplicateRate: number;
    errorRate: number;
    unverifiedRate: number;
    coverageStatus: "CALCULATED" | "DENOMINATOR_UNKNOWN";
    coveragePercent: number | null;
  };
  bySource: CoverageRow[];
  byProvince: CoverageRow[];
  bySector: CoverageRow[];
  byProduct: { productCode: string; productName: string; fitCount: number; avgFitScore: number; minFitThreshold: number }[];
  sourceHealth: {
    sourceId: string; name: string; type: string; isActive: boolean; accessPolicy: string;
    lastRunAt: string | null; status: string; errorJobs: number; totalJobs: number;
  }[];
  gaps: CoverageGap[];
  segments: {
    id: string; name: string; province: string | null; sector: string | null; productCode: string | null;
    estimatedTotal: number | null; denominatorSource: string | null; documented: boolean;
    matchedCompanies: number; coveragePercent: number | null;
    coverageStatus: "CALCULATED" | "UNDOCUMENTED";
  }[];
  marketCoverageNote: string;
};

function pct(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

type CompanyAgg = {
  id: string;
  name: string;
  province: string | null;
  sector: string | null;
  verificationStatus: string;
  priorityTier: string;
  updatedAt: Date;
  contactPoints: { id: string }[];
  productFits: { productCode: string; fitScore: number }[];
  sourceRecords: { status: string; collectedAt: Date }[];
};

export async function computeCoverage(config: ScoringConfig): Promise<CoverageReport> {
  const [companies, records, sources, jobs, products, segments] = await Promise.all([
    db.company.findMany({
      select: {
        id: true, name: true, province: true, sector: true, verificationStatus: true,
        priorityTier: true, updatedAt: true,
        contactPoints: { select: { id: true } },
        productFits: { select: { productCode: true, fitScore: true } },
        sourceRecords: { select: { status: true, collectedAt: true } },
      },
    }),
    db.sourceRecord.groupBy({ by: ["status"], _count: { _all: true } }),
    db.source.findMany({ select: { id: true, name: true, type: true, isActive: true, accessPolicy: true, lastRunAt: true } }),
    db.collectionJob.groupBy({ by: ["sourceId", "status"], _count: { _all: true } }),
    db.product.findMany({ orderBy: { sortOrder: "asc" } }),
    db.segment.findMany(),
  ]);

  const recordCount = (s: string) => records.find((r) => r.status === s)?._count._all ?? 0;
  const totalRecords = records.reduce((a, r) => a + r._count._all, 0);
  const duplicateRecords = recordCount("DUPLICATE");
  const errorRecords = recordCount("ERROR");

  function evaluate(dimension: string, key: string, group: CompanyAgg[], lastCollectedAt: Date | null): CoverageRow {
    const validData = group.filter((c) => c.name && c.contactPoints.length > 0).length;
    const verified = group.filter((c) => c.verificationStatus === "VERIFIED").length;
    const unverified = group.filter((c) => c.verificationStatus === "UNVERIFIED").length;
    const productFit: Record<string, number> = {};
    for (const code of PRODUCT_CODES) {
      const minFit = config.productCriteria[code]?.minFitScore ?? 50;
      productFit[code] = group.filter((c) =>
        c.productFits.some((f) => f.productCode === code && f.fitScore >= minFit)
      ).length;
    }
    const groupRecords = group.flatMap((c) => c.sourceRecords);
    const gDup = groupRecords.filter((r) => r.status === "DUPLICATE").length;
    const gErr = groupRecords.filter((r) => r.status === "ERROR").length;
    const gTotal = groupRecords.length;
    const seg = segments.find((s) =>
      s.documented && s.estimatedTotal && (
        (dimension === "province" && s.province === key) ||
        (dimension === "sector" && s.sector === key)
      )
    );
    const denominator = seg?.estimatedTotal ?? null;
    const coveragePercent = denominator && denominator > 0
      ? Math.round((group.length / denominator) * 1000) / 10
      : null;
    return {
      dimension, key,
      discovered: gTotal,
      afterDedup: group.length,
      validData,
      verified,
      productFit,
      requiredFieldRate: pct(validData, group.length) ?? 0,
      duplicateRate: pct(gDup, gTotal) ?? 0,
      errorRate: pct(gErr, gTotal) ?? 0,
      unverifiedRate: pct(unverified, group.length) ?? 0,
      lastCollectedAt: lastCollectedAt ? lastCollectedAt.toISOString() : null,
      denominator,
      denominatorSource: seg?.denominatorSource ?? null,
      coveragePercent,
      coverageStatus: denominator ? ("CALCULATED" as const) : ("DENOMINATOR_UNKNOWN" as const),
    };
  }

  // ---- byProvince / bySector ----
  const provinceMap = new Map<string, CompanyAgg[]>();
  for (const c of companies) {
    const k = c.province ?? "(Chưa xác định)";
    if (!provinceMap.has(k)) provinceMap.set(k, []);
    provinceMap.get(k)!.push(c);
  }
  const byProvince = [...provinceMap.entries()]
    .map(([k, g]) => evaluate("province", k, g,
      g.flatMap((c) => c.sourceRecords).map((r) => r.collectedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null))
    .sort((a, b) => b.afterDedup - a.afterDedup);

  const sectorMap = new Map<string, CompanyAgg[]>();
  for (const c of companies) {
    const k = c.sector ?? "(Chưa xác định)";
    if (!sectorMap.has(k)) sectorMap.set(k, []);
    sectorMap.get(k)!.push(c);
  }
  const bySector = [...sectorMap.entries()]
    .map(([k, g]) => evaluate("sector", k, g, null))
    .sort((a, b) => b.afterDedup - a.afterDedup);

  // ---- bySource: nhóm company theo nguồn (qua SourceRecord.companyId) ----
  const links = await db.sourceRecord.findMany({
    where: { companyId: { not: null } },
    select: { sourceId: true, status: true, company: { select: { id: true, verificationStatus: true, contactPoints: { select: { id: true } }, productFits: { select: { productCode: true, fitScore: true } } } } },
  });
  const sourceCompanyMap = new Map<string, Map<string, { verificationStatus: string; contactPoints: { id: string }[]; productFits: { productCode: string; fitScore: number }[] }>>();
  const sourceDup = new Map<string, number>();
  const sourceErr = new Map<string, number>();
  const sourceTotal = new Map<string, number>();
  const recBySource = await db.sourceRecord.groupBy({ by: ["sourceId", "status"], _count: { _all: true } });
  for (const s of sources) {
    const st = recBySource.filter((r) => r.sourceId === s.id);
    sourceTotal.set(s.id, st.reduce((a, r) => a + r._count._all, 0));
    sourceDup.set(s.id, st.find((r) => r.status === "DUPLICATE")?._count._all ?? 0);
    sourceErr.set(s.id, st.find((r) => r.status === "ERROR")?._count._all ?? 0);
  }
  for (const l of links) {
    if (!l.company) continue;
    if (!sourceCompanyMap.has(l.sourceId)) sourceCompanyMap.set(l.sourceId, new Map());
    const m = sourceCompanyMap.get(l.sourceId)!;
    m.set(l.company.id, { verificationStatus: l.company.verificationStatus, contactPoints: l.company.contactPoints, productFits: l.company.productFits });
  }
  const bySource: CoverageRow[] = sources.map((s) => {
    const compMap = sourceCompanyMap.get(s.id) ?? new Map();
    const group: CompanyAgg[] = [...compMap.values()].map((c) => ({
      id: "", name: "", province: null, sector: null, verificationStatus: c.verificationStatus,
      priorityTier: "", updatedAt: new Date(0),
      contactPoints: c.contactPoints, productFits: c.productFits, sourceRecords: [],
    }));
    const total = sourceTotal.get(s.id) ?? 0;
    return {
      dimension: "source",
      key: s.name,
      discovered: total,
      afterDedup: compMap.size,
      validData: group.filter((c) => c.contactPoints.length > 0).length,
      verified: group.filter((c) => c.verificationStatus === "VERIFIED").length,
      productFit: Object.fromEntries(PRODUCT_CODES.map((code) => {
        const minFit = config.productCriteria[code]?.minFitScore ?? 50;
        return [code, group.filter((c) => c.productFits.some((f) => f.productCode === code && f.fitScore >= minFit)).length];
      })),
      requiredFieldRate: group.length ? 100 : 0,
      duplicateRate: pct(sourceDup.get(s.id) ?? 0, total) ?? 0,
      errorRate: pct(sourceErr.get(s.id) ?? 0, total) ?? 0,
      unverifiedRate: pct(group.filter((c) => c.verificationStatus === "UNVERIFIED").length, group.length) ?? 0,
      lastCollectedAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
      denominator: null,
      denominatorSource: null,
      coveragePercent: null,
      coverageStatus: "DENOMINATOR_UNKNOWN" as const,
    };
  }).sort((a, b) => b.afterDedup - a.afterDedup);

  // ---- byProduct ----
  const byProduct = products.map((p) => {
    const rows = companies.map((c) => c.productFits.find((f) => f.productCode === p.code)).filter(Boolean) as { fitScore: number }[];
    const minFit = config.productCriteria[p.code as ProductCode]?.minFitScore ?? 50;
    const fitCount = rows.filter((f) => f.fitScore >= minFit).length;
    const avg = rows.length ? Math.round(rows.reduce((a, f) => a + f.fitScore, 0) / rows.length) : 0;
    return { productCode: p.code, productName: p.name, fitCount, avgFitScore: avg, minFitThreshold: minFit };
  });

  // ---- sourceHealth ----
  const sourceHealth = sources.map((s) => {
    const sJobs = jobs.filter((j) => j.sourceId === s.id);
    const errorJobs = sJobs.find((j) => j.status === "FAILED")?._count._all ?? 0;
    const totalJobs = sJobs.reduce((a, j) => a + j._count._all, 0);
    return {
      sourceId: s.id, name: s.name, type: s.type, isActive: s.isActive,
      accessPolicy: s.accessPolicy,
      lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
      status: !s.isActive ? "NOT_ACTIVE" : errorJobs > 0 ? "ERRORS" : totalJobs === 0 ? "NEVER_RUN" : "OK",
      errorJobs, totalJobs,
    };
  });

  // ---- overall ----
  const validData = companies.filter((c) => c.name && c.contactPoints.length > 0).length;
  const verified = companies.filter((c) => c.verificationStatus === "VERIFIED").length;
  const unverified = companies.filter((c) => c.verificationStatus === "UNVERIFIED").length;
  const overall: CoverageReport["overall"] = {
    companies: companies.length,
    validData,
    verified,
    highPriority: companies.filter((c) => c.priorityTier === "HIGH").length,
    needsVerification: companies.filter((c) => c.priorityTier === "NEEDS_VERIFICATION").length,
    sourceRecords: totalRecords,
    duplicateRecords,
    errorRecords,
    needsReviewRecords: recordCount("NEEDS_REVIEW"),
    requiredFieldRate: pct(validData, companies.length) ?? 0,
    duplicateRate: pct(duplicateRecords, totalRecords) ?? 0,
    errorRate: pct(errorRecords, totalRecords) ?? 0,
    unverifiedRate: pct(unverified, companies.length) ?? 0,
    coverageStatus: "DENOMINATOR_UNKNOWN",
    coveragePercent: null,
  };

  // ---- segments có mẫu số được tài liệu hóa ----
  const segReport = segments.map((s) => {
    const matched = companies.filter((c) =>
      (!s.province || c.province === s.province) &&
      (!s.sector || c.sector === s.sector)
    ).length;
    const documented = !!(s.estimatedTotal && s.denominatorSource);
    return {
      id: s.id, name: s.name, province: s.province, sector: s.sector,
      productCode: s.productCode,
      estimatedTotal: s.estimatedTotal,
      denominatorSource: s.denominatorSource,
      documented,
      matchedCompanies: matched,
      coveragePercent: documented && (s.estimatedTotal ?? 0) > 0
        ? Math.round((matched / (s.estimatedTotal ?? 1)) * 1000) / 10
        : null,
      coverageStatus: documented ? "CALCULATED" as const : "UNDOCUMENTED" as const,
    };
  });

  // ---- Phát hiện khoảng trống ----
  const gaps: CoverageGap[] = [];
  for (const sh of sourceHealth) {
    if (sh.status === "ERRORS") {
      gaps.push({
        type: "SOURCE_ERROR", severity: "CRITICAL",
        message: `Nguồn "${sh.name}" có ${sh.errorJobs} lần chạy lỗi`,
        suggestion: "Kiểm tra nhật ký job, xác minh URL/quyền truy cập trước khi bật lại",
      });
    }
    if (sh.status === "NEVER_RUN" && sh.isActive) {
      gaps.push({
        type: "SOURCE_NEVER_RUN", severity: "WARNING",
        message: `Nguồn "${sh.name}" đã bật nhưng chưa từng chạy`,
        suggestion: "Tạo job thu thập hoặc kiểm tra cấu hình adapter",
      });
    }
    if (sh.accessPolicy === "REVIEW_REQUIRED") {
      gaps.push({
        type: "SOURCE_REVIEW", severity: "INFO",
        message: `Nguồn "${sh.name}" đang chờ xem xét quyền truy cập/sử dụng dữ liệu`,
        suggestion: "Kiểm tra điều khoản sử dụng và robots.txt rồi mới bật thu thập",
      });
    }
  }
  if (companies.length >= 10 && (overall.unverifiedRate ?? 0) > 60) {
    gaps.push({
      type: "HIGH_UNVERIFIED", severity: "WARNING",
      message: `${overall.unverifiedRate}% doanh nghiệp chưa xác minh dữ liệu`,
      suggestion: "Chạy quy trình xác minh MST/kênh liên hệ trước khi đưa vào hàng đợi tiếp cận",
    });
  }
  for (const r of byProvince) {
    if (r.key !== "(Chưa xác định)" && r.afterDedup > 0 && r.afterDedup < 5) {
      gaps.push({
        type: "LOW_SEGMENT", severity: "INFO",
        message: `Tỉnh "${r.key}" chỉ có ${r.afterDedup} doanh nghiệp — chưa đủ dữ liệu để kết luận`,
        suggestion: "Bổ sung nguồn dữ liệu cho khu vực này trước khi đánh giá bao phủ",
      });
    }
  }
  const sourceTypes = new Set(sources.map((s) => s.type));
  if (!sourceTypes.has("PUBLIC_DIRECTORY") && !sourceTypes.has("OFFICIAL_REGISTRY")) {
    gaps.push({
      type: "MISSING_SOURCE_TYPE", severity: "WARNING",
      message: "Chưa có nguồn danh bạ công khai/đăng ký chính thức nào được tích hợp",
      suggestion: "Thêm nguồn đăng ký doanh nghiệp được phép sử dụng để giảm bỏ sót thị trường",
    });
  }
  if (overall.needsReviewRecords > 0) {
    gaps.push({
      type: "REVIEW_BACKLOG", severity: "INFO",
      message: `${overall.needsReviewRecords} bản ghi đang chờ xem xét hợp nhất thủ công`,
      suggestion: "Xử lý hàng đợi xem xét để tránh bỏ sót doanh nghiệp trùng lặp",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    overall,
    bySource,
    byProvince,
    bySector,
    byProduct,
    sourceHealth,
    gaps,
    segments: segReport,
    marketCoverageNote:
      "Chưa xác định mẫu số bao phủ — hệ thống KHÔNG tính tỷ lệ phần trăm thị trường khi chưa có danh mục tổng thể được tài liệu hóa. Chỉ phân khúc khai báo mẫu số kèm nguồn trích dẫn mới hiển thị %.",
  };
}
