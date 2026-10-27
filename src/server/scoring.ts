// ============================================================
// Module 5 — Lead Scoring Engine (pure, có giải thích, versioned)
// Thang điểm 0-100:
//   Phù hợp sản phẩm 0-30 | Bằng chứng nhu cầu 0-25 | Phân khúc 0-20
//   Khả năng liên hệ (kênh công khai phù hợp) 0-15 | Độ mới & xác minh dữ liệu 0-10
// Thiếu dữ liệu → giảm tin cậy, KHÔNG tạo độ tin cậy giả
// ============================================================

import { MatchingCompany, matchProducts, ProductFitResult } from "./matching";
import { ScoringConfig, EVIDENCE_CONFIDENCE_POINTS } from "./scoring-config";

export type Tier = "HIGH" | "NEEDS_VERIFICATION" | "LOW" | "NOT_SUITABLE";

export type ScoreComponent = {
  score: number;
  max: number;
  explanation: string;
};

export type ScoreResult = {
  totalScore: number;
  components: {
    productFit: ScoreComponent;
    evidence: ScoreComponent;
    segment: ScoreComponent;
    contact: ScoreComponent;
    freshness: ScoreComponent;
  };
  fits: ProductFitResult[];
  topProduct: ProductFitResult | null;
  tier: Tier;
  ruleVersion: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  tierReason: string;
};

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));

export function scoreLead(
  company: MatchingCompany,
  rawEvidence: { kind: string; confidence: string; recordedAt?: Date }[],
  config: ScoringConfig,
  opts: {
    lastVerifiedAt?: Date | null;
    updatedAt?: Date | null;
    publicContactCount?: number; // kênh liên hệ công khai đã chuẩn hóa
    ruleVersion: string;
  }
): ScoreResult {
  const w = config.weights;
  const fits = matchProducts(company, config);
  const activeFits = fits.filter((f) => f.fitScore > 0).sort((a, b) => b.fitScore - a.fitScore);
  const topProduct = activeFits[0] ?? null;

  // ---- 1) Phù hợp sản phẩm (0-30): theo fitScore của sản phẩm tốt nhất ----
  const productFitScore = topProduct
    ? clamp((topProduct.fitScore / 100) * w.productFit, w.productFit)
    : 0;
  const productFit: ScoreComponent = {
    score: productFitScore,
    max: w.productFit,
    explanation: topProduct
      ? `Sản phẩm phù hợp nhất: ${topProduct.productCode} (fit ${topProduct.fitScore}/100)`
      : "Chưa có sản phẩm nào khớp tiêu chí",
  };

  // ---- 2) Bằng chứng nhu cầu (0-25): điểm theo kind+confidence, có cap ----
  let evRaw = 0;
  const evDetails: string[] = [];
  for (const ev of rawEvidence) {
    const base = EVIDENCE_CONFIDENCE_POINTS[ev.confidence] ?? 2;
    // các kind phản ánh nhu cầu thực được hệ số cao hơn
    const demandKinds = ["HIRING", "HIRING_ACCOUNTANT", "ACCOUNTING_ACTIVITY", "EXPANSION", "DIGITIZATION_SIGNAL", "PROCESS_SIGNAL", "E_SIGN_SIGNAL"];
    const factor = demandKinds.includes(ev.kind) ? 1.5 : 1;
    const pts = Math.min(12, Math.round(base * factor));
    evRaw += pts;
    evDetails.push(`${ev.kind}/${ev.confidence} +${pts}`);
  }
  const evidenceScore = clamp(evRaw, w.evidence);
  const evidence: ScoreComponent = {
    score: evidenceScore,
    max: w.evidence,
    explanation: rawEvidence.length
      ? `${rawEvidence.length} bằng chứng: ${evDetails.join(", ")}`
      : "Chưa có bằng chứng nhu cầu — không được cho điểm theo quy mô",
  };

  // ---- 3) Phân khúc (0-20): tỉnh trọng điểm + trạng thái hoạt động + có website ----
  let seg = 0;
  const segNotes: string[] = [];
  if (company.province && config.keyProvinces.includes(company.province)) {
    seg += 10;
    segNotes.push(`Khu vực trọng điểm (${company.province}) +10`);
  } else if (company.province) {
    seg += 4;
    segNotes.push(`Có địa phương xác định (${company.province}) +4`);
  } else {
    segNotes.push("Chưa xác định địa phương — không cộng điểm khu vực");
  }
  if (company.businessStatus === "ACTIVE") {
    seg += 6;
    segNotes.push("Trạng thái hoạt động: ACTIVE (nguồn tin cậy) +6");
  }
  if (company.sector) {
    seg += 4;
    segNotes.push("Có ngành nghề xác định +4");
  }
  const segmentScore = clamp(seg, w.segment);
  const segment: ScoreComponent = {
    score: segmentScore,
    max: w.segment,
    explanation: segNotes.join("; "),
  };

  // ---- 4) Khả năng liên hệ qua kênh công khai phù hợp (0-15) ----
  const pc = opts.publicContactCount ?? 0;
  let contactScore = 0;
  const contactNotes: string[] = [];
  if (pc >= 2) {
    contactScore = w.contact;
    contactNotes.push(`${pc} kênh liên hệ công khai hợp lệ +${w.contact}`);
  } else if (pc === 1) {
    contactScore = Math.round(w.contact * 0.6);
    contactNotes.push(`1 kênh liên hệ công khai (chưa xác minh) +${contactScore}`);
  } else {
    contactNotes.push("Không có kênh liên hệ công khai — 0 điểm, cần bổ sung");
  }
  const contact: ScoreComponent = { score: clamp(contactScore, w.contact), max: w.contact, explanation: contactNotes.join("; ") };

  // ---- 5) Độ mới & khả năng xác minh dữ liệu (0-10) ----
  const refDate = opts.updatedAt ?? new Date(0);
  const daysOld = Math.max(0, (Date.now() - refDate.getTime()) / 86400000);
  let fresh = 0;
  if (daysOld <= config.freshnessDays) fresh = w.freshness;
  else if (daysOld <= config.freshnessDays * 4) {
    fresh = Math.round(w.freshness * (1 - (daysOld - config.freshnessDays) / (config.freshnessDays * 3)));
  }
  const verifiedBonus = opts.lastVerifiedAt ? 0 : -0; // giữ đơn giản: xác minh gần nhất tăng freshness
  let freshnessScore = clamp(fresh + verifiedBonus, w.freshness);
  if (company.businessStatus === "INACTIVE") freshnessScore = 0;
  const freshness: ScoreComponent = {
    score: freshnessScore,
    max: w.freshness,
    explanation:
      company.businessStatus === "INACTIVE"
        ? "Doanh nghiệp không còn hoạt động — 0 điểm độ mới"
        : `Dữ liệu ${Math.round(daysOld)} ngày tuổi (chu kỳ làm mới ${config.freshnessDays} ngày)`,
  };

  // ---- Tổng & phân hạng ----
  const totalScore =
    productFitScore + evidenceScore + segmentScore + contactScore + freshnessScore;

  const criticalMissing = company.missingFields.filter((f) => ["taxCode", "contact", "sector"].includes(f));
  const confidence: ScoreResult["confidence"] =
    criticalMissing.length === 0 && opts.lastVerifiedAt ? "HIGH"
    : criticalMissing.length <= 1 ? "MEDIUM"
    : "LOW";

  const t = config.tierThresholds;
  let tier: Tier;
  let tierReason: string;
  if (totalScore < t.low) {
    tier = "NOT_SUITABLE";
    tierReason = `Điểm ${totalScore} dưới ngưỡng "Ưu tiên thấp" (${t.low}) và không có bằng chứng nhu cầu`;
  } else if (totalScore >= t.high && confidence !== "LOW") {
    tier = "HIGH";
    tierReason = `Điểm ${totalScore} ≥ ngưỡng ưu tiên cao (${t.high}) và tin cậy ${confidence}`;
  } else if (totalScore >= t.needsVerification || confidence === "LOW") {
    tier = "NEEDS_VERIFICATION";
    tierReason =
      confidence === "LOW"
        ? `Tin cậy thấp do thiếu: ${criticalMissing.join(", ") || "dữ liệu nền"} — cần xác minh thêm dù điểm ${totalScore}`
        : `Điểm ${totalScore} nằm trong dải cần xác minh (${t.needsVerification}–${t.high})`;
  } else {
    tier = "LOW";
    tierReason = `Điểm ${totalScore} trong dải ưu tiên thấp (${t.low}–${t.needsVerification})`;
  }

  return {
    totalScore,
    components: { productFit, evidence, segment, contact, freshness },
    fits,
    topProduct,
    tier,
    ruleVersion: opts.ruleVersion,
    confidence,
    tierReason,
  };
}
