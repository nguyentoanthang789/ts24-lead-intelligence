// ============================================================
// Module 5 — Product Matching: đánh giá mức phù hợp từng sản phẩm TS24 (pure)
// Không cho điểm cao chỉ vì quy mô lớn; không dùng thông tin chưa có bằng chứng
// ============================================================

import {
  ProductCode, PRODUCT_CODES, ScoringConfig, EVIDENCE_CONFIDENCE_POINTS,
} from "./scoring-config";

export type MatchingCompany = {
  name: string;
  sector: string | null;           // đã chuẩn hóa (bỏ dấu, lowercase)
  province: string | null;
  businessStatus: string;          // ACTIVE | INACTIVE | UNKNOWN
  establishedYear: number | null;
  sizeSignal: string | null;       // chỉ khi nguồn xác thực
  evidenceKinds: { kind: string; confidence: string }[];
  hasPublicContact: boolean;
  missingFields: string[];
};

export type ProductFitResult = {
  productCode: ProductCode;
  fitScore: number; // 0-100
  reasons: string[];
  missingFields: string[];
  needsVerification: boolean;
};

function sectorMatches(sector: string | null, keywords: string[]): string | null {
  if (!sector) return null;
  for (const kw of keywords) {
    const k = kw.trim().toLowerCase();
    if (k && sector.includes(k.trim())) return k;
  }
  return null;
}

export function matchProducts(
  company: MatchingCompany,
  config: ScoringConfig
): ProductFitResult[] {
  const results: ProductFitResult[] = [];
  // Mức tin cậy tổng: giảm nếu còn nhiều trường thiếu
  const criticalMissing = company.missingFields.filter((f) =>
    ["taxCode", "contact", "sector"].includes(f)
  );

  for (const code of PRODUCT_CODES) {
    const criteria = config.productCriteria[code];
    const product = code as ProductCode;
    if (!criteria) {
      results.push({ productCode: product, fitScore: 0, reasons: [], missingFields: company.missingFields, needsVerification: true });
      continue;
    }
    let score = 0;
    const reasons: string[] = [];

    // 1) Sector match — nền tảng, tối đa 40 điểm fit
    const matchedKw = sectorMatches(company.sector, criteria.sectorKeywords);
    if (matchedKw) {
      score += 40;
      reasons.push(`Ngành nghề "${company.sector}" khớp phân khúc mục tiêu sản phẩm ${code} (từ khóa "${matchedKw}")`);
    }

    // 2) Bằng chứng theo kind — cộng điểm theo rule, cap 60
    let evidencePoints = 0;
    for (const ev of company.evidenceKinds) {
      const rule = criteria.signals.find((s) => s.kind === ev.kind);
      if (!rule) continue;
      const confFactor =
        ev.confidence === "HIGH" ? 1 : ev.confidence === "MEDIUM" ? 0.7 : 0.4;
      const pts = Math.round(rule.points * confFactor);
      if (pts > 0) {
        evidencePoints += pts;
        reasons.push(`Bằng chứng [${ev.kind}/${ev.confidence}]: ${rule.label} (+${pts})`);
      }
    }
    score += Math.min(60, evidencePoints);

    // 3) Công ty mới — tín hiệu cho B (kê khai thuế), nhỏ cho A
    if (company.establishedYear) {
      const nowYear = new Date().getFullYear();
      const age = nowYear - company.establishedYear;
      if (age <= config.newBusinessYears && (code === "B" || code === "A")) {
        const pts = code === "B" ? 15 : 5;
        score += pts;
        reasons.push(`Doanh nghiệp mới hoạt động (~${age} năm) — phù hợp khởi tạo nghiệp vụ ${code === "B" ? "kê khai thuế" : "hóa đơn"} (+${pts})`);
      }
    }

    // 4) Có kênh liên hệ công khai — tín hiệu tiếp cận phụ, rất nhỏ, chỉ khi có bằng chứng PUBLIC_CONTACT
    if (company.hasPublicContact && company.evidenceKinds.some((e) => e.kind === "PUBLIC_CONTACT")) {
      score += 5;
      reasons.push("Công bố kênh liên hệ kinh doanh (+5)");
    }

    const fitScore = Math.max(0, Math.min(100, score));
    const needsVerification = criticalMissing.length > 0 || (matchedKw === null && evidencePoints === 0);

    results.push({
      productCode: product,
      fitScore,
      reasons,
      missingFields: company.missingFields,
      needsVerification,
    });
  }
  return results;
}
