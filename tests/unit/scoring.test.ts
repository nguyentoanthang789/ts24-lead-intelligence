// Test C — Chấm điểm: biên điểm, giải thích, thiếu dữ liệu không tạo tin cậy giả,
// điểm fit riêng từng sản phẩm, versioning quy tắc
import { describe, test, expect } from "bun:test";
import { scoreLead } from "../../src/server/scoring";
import { matchProducts } from "../../src/server/matching";
import { DEFAULT_SCORING_CONFIG, validateScoringConfig, ScoringConfig } from "../../src/server/scoring-config";

const baseCompany = {
  name: "Cong ty TNHH Test",
  sector: "thuong mai phan phoi",
  province: "TP. Hồ Chí Minh",
  businessStatus: "ACTIVE",
  establishedYear: 2023,
  sizeSignal: null,
  evidenceKinds: [] as { kind: string; confidence: string }[],
  hasPublicContact: true,
  missingFields: [] as string[],
};

describe("Scoring — biên điểm hợp lệ", () => {
  test("điểm tổng nằm trong 0-100 và từng thành phần trong biên", () => {
    const r = scoreLead(
      baseCompany,
      [{ kind: "HIRING", confidence: "HIGH" }, { kind: "EXPANSION", confidence: "MEDIUM" }],
      DEFAULT_SCORING_CONFIG,
      { ruleVersion: "v1", publicContactCount: 2, updatedAt: new Date() }
    );
    expect(r.totalScore).toBeGreaterThanOrEqual(0);
    expect(r.totalScore).toBeLessThanOrEqual(100);
    expect(r.components.productFit.score).toBeLessThanOrEqual(30);
    expect(r.components.evidence.score).toBeLessThanOrEqual(25);
    expect(r.components.segment.score).toBeLessThanOrEqual(20);
    expect(r.components.contact.score).toBeLessThanOrEqual(15);
    expect(r.components.freshness.score).toBeLessThanOrEqual(10);
  });

  test("không có dữ liệu gì → điểm thấp, không được cho điểm theo quy mô", () => {
    const empty = {
      ...baseCompany, sector: null, province: null, businessStatus: "UNKNOWN",
      establishedYear: null, hasPublicContact: false, missingFields: ["taxCode", "contact", "sector", "province"],
    };
    const r = scoreLead(empty, [], DEFAULT_SCORING_CONFIG, { ruleVersion: "v1" });
    expect(r.totalScore).toBeLessThan(DEFAULT_SCORING_CONFIG.tierThresholds.low);
    expect(r.tier).toBe("NOT_SUITABLE");
    expect(r.components.evidence.score).toBe(0);
  });

  test("quy mô lớn nhưng không có bằng chứng → KHÔNG được điểm bằng chứng", () => {
    const big = { ...baseCompany, sizeSignal: "1000+ nhân viên" };
    const r = scoreLead(big, [], DEFAULT_SCORING_CONFIG, { ruleVersion: "v1" });
    expect(r.components.evidence.score).toBe(0);
  });
});

describe("Scoring — phân hạng có giải thích", () => {
  test("lead mạnh → HIGH kèm lý do", () => {
    const strong = {
      ...baseCompany,
      sector: "thuong mai",
      evidenceKinds: [{ kind: "EXPANSION", confidence: "HIGH" }, { kind: "BRANCHES", confidence: "HIGH" }],
      missingFields: [],
    };
    const r = scoreLead(strong, [
      { kind: "EXPANSION", confidence: "HIGH" }, { kind: "BRANCHES", confidence: "HIGH" },
    ], DEFAULT_SCORING_CONFIG, { ruleVersion: "v1", publicContactCount: 2, updatedAt: new Date(), lastVerifiedAt: new Date() });
    expect(r.tier).toBe("HIGH");
    expect(r.tierReason.length).toBeGreaterThan(5);
    expect(r.components.productFit.explanation).toContain("Sản phẩm phù hợp nhất");
  });

  test("thiếu nhiều trường → NEEDS_VERIFICATION dù điểm khá (không tạo tin cậy giả)", () => {
    const unstable = {
      ...baseCompany,
      missingFields: ["taxCode", "contact", "sector"],
      evidenceKinds: [{ kind: "EXPANSION", confidence: "HIGH" }],
    };
    const r = scoreLead(unstable, [{ kind: "EXPANSION", confidence: "HIGH" }], DEFAULT_SCORING_CONFIG, { ruleVersion: "v1" });
    expect(r.confidence).toBe("LOW");
    expect(r.tier).toBe("NEEDS_VERIFICATION");
    expect(r.tierReason).toContain("Tin cậy thấp");
  });

  test("dữ liệu cũ vượt 4x chu kỳ → freshness giảm", () => {
    const old = new Date(Date.now() - 500 * 86400000);
    const r = scoreLead(baseCompany, [], DEFAULT_SCORING_CONFIG, { ruleVersion: "v1", updatedAt: old });
    expect(r.components.freshness.score).toBe(0);
  });

  test("INACTIVE → freshness = 0", () => {
    const r = scoreLead({ ...baseCompany, businessStatus: "INACTIVE" }, [], DEFAULT_SCORING_CONFIG, { ruleVersion: "v1", updatedAt: new Date() });
    expect(r.components.freshness.score).toBe(0);
  });
});

describe("Matching — điểm fit RIÊNG cho từng sản phẩm", () => {
  test("cùng 1 công ty có thể fit khác nhau giữa 6 sản phẩm", () => {
    const fits = matchProducts(baseCompany, DEFAULT_SCORING_CONFIG);
    expect(fits).toHaveLength(6);
    const codes = fits.map((f) => f.productCode).sort();
    expect(codes).toEqual(["A", "B", "C", "D", "E", "F"]);
    // A (thương mại) phải fit cao hơn D (bảo hiểm) với sector này
    const a = fits.find((f) => f.productCode === "A")!;
    const d = fits.find((f) => f.productCode === "D")!;
    expect(a.fitScore).toBeGreaterThan(d.fitScore);
    expect(a.reasons.length).toBeGreaterThan(0);
    // mọi fit đều trong 0-100
    for (const f of fits) {
      expect(f.fitScore).toBeGreaterThanOrEqual(0);
      expect(f.fitScore).toBeLessThanOrEqual(100);
    }
  });

  test("công ty mới có tín hiệu kê khai thuế (B) được ghi nhận", () => {
    const fits = matchProducts({ ...baseCompany, establishedYear: new Date().getFullYear() - 1 }, DEFAULT_SCORING_CONFIG);
    const b = fits.find((f) => f.productCode === "B")!;
    expect(b.reasons.some((r) => r.includes("mới"))).toBe(true);
  });
});

describe("ScoringConfig — validate và versioning", () => {
  test("config mặc định hợp lệ", () => {
    const v = validateScoringConfig(DEFAULT_SCORING_CONFIG);
    expect(v.ok).toBe(true);
    expect(DEFAULT_SCORING_CONFIG.version).toBeGreaterThanOrEqual(1);
  });
  test("tổng trọng số sai → báo lỗi", () => {
    const bad: ScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      weights: { productFit: 50, evidence: 25, segment: 20, contact: 15, freshness: 10 },
    };
    const v = validateScoringConfig(bad);
    expect(v.ok).toBe(false);
    expect(v.errors[0]).toContain("100");
  });
  test("ruleVersion đi kèm kết quả chấm điểm (truy xuất phiên bản)", () => {
    const r = scoreLead(baseCompany, [], DEFAULT_SCORING_CONFIG, { ruleVersion: `v${DEFAULT_SCORING_CONFIG.version}` });
    expect(r.ruleVersion).toMatch(/^v\d+$/);
  });
});
