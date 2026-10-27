// Test A — Identity Resolution & Deduplication (pure logic)
import { describe, test, expect } from "bun:test";
import { matchCompany, needsManualReview, buildSourceDedupKey, DedupCandidate } from "../../src/server/dedup";

const candidates: DedupCandidate[] = [
  {
    id: "c1", taxCode: "0312345677", taxCodeStatus: "VERIFIED", domain: "minhphat.vn",
    province: "TP. Hồ Chí Minh", nameKey: "minh phat", phoneNumbers: ["84901234567"],
  },
  {
    id: "c2", taxCode: "0101234565", taxCodeStatus: "VERIFIED", domain: "nhaxanh.vn",
    province: "Hà Nội", nameKey: "ban le nha xanh", phoneNumbers: ["84912345678"],
  },
];

describe("Dedup — thứ tự đối chiếu MST > domain > phone > name+province", () => {
  test("MST trùng → gộp chắc chắn HIGH", () => {
    const m = matchCompany(
      { taxCode: "0312345677", domain: "khac.vn", phones: ["84999999999"], nameKey: "khac", province: "Hà Nội" },
      candidates
    );
    expect(m.type).toBe("TAX_CODE");
    expect(m.confidence).toBe("HIGH");
    if (m.companyId !== null) expect(m.companyId).toBe("c1");
  });

  test("domain trùng (không có MST) → gộp HIGH", () => {
    const m = matchCompany(
      { taxCode: null, domain: "nhaxanh.vn", phones: [], nameKey: "nha xanh", province: "Hà Nội" },
      candidates
    );
    expect(m.type).toBe("DOMAIN");
    expect(m.companyId).toBe("c2");
  });

  test("phone trùng → gộp MEDIUM", () => {
    const m = matchCompany(
      { taxCode: null, domain: "khac.vn", phones: ["84912345678"], nameKey: "ten khac", province: "Hà Nội" },
      candidates
    );
    expect(m.type).toBe("PHONE");
    expect(m.confidence).toBe("MEDIUM");
  });

  test("nameKey + cùng tỉnh trùng chính xác → gộp MEDIUM", () => {
    const m = matchCompany(
      { taxCode: null, domain: null, phones: [], nameKey: "minh phat", province: "TP. Hồ Chí Minh" },
      candidates
    );
    expect(m.type).toBe("NAME_PROVINCE");
  });

  test("nameKey giống nhưng KHÁC tỉnh → KHÔNG gộp tự động", () => {
    const m = matchCompany(
      { taxCode: null, domain: null, phones: [], nameKey: "minh phat", province: "Bình Dương" },
      candidates
    );
    expect(m.type).toBe("NONE");
  });

  test("không có tín hiệu nào → NONE", () => {
    const m = matchCompany(
      { taxCode: null, domain: null, phones: [], nameKey: "cong ty moi", province: null },
      candidates
    );
    expect(m.type).toBe("NONE");
  });
});

describe("Dedup — trường hợp không chắc chắn → hàng đợi xem xét", () => {
  test("trùng nameKey khác tỉnh → review", () => {
    const r = needsManualReview(
      { taxCode: null, domain: null, phones: [], nameKey: "minh phat", province: "Bình Dương" },
      candidates
    );
    expect(r.review).toBe(true);
    expect(r.reason).toContain("khác tỉnh");
  });

  test("thiếu tất cả định danh mạnh + tên tương tự → review", () => {
    const r = needsManualReview(
      { taxCode: null, domain: null, phones: [], nameKey: "minh", province: null },
      candidates
    );
    expect(r.review).toBe(true);
  });

  test("bản ghi có MST riêng → không review", () => {
    const r = needsManualReview(
      { taxCode: "0999999999", domain: null, phones: ["84988888888"], nameKey: "minh phat", province: "Bình Dương" },
      candidates
    );
    expect(r.review).toBe(false);
  });
});

describe("Dedup — dedupKey của SourceRecord", () => {
  test("ưu tiên MST > domain > name+province", () => {
    expect(buildSourceDedupKey({ taxCode: "0312345677" })).toBe("tax:0312345677");
    expect(buildSourceDedupKey({ domain: "x.vn" })).toBe("dom:x.vn");
    expect(buildSourceDedupKey({ nameKey: "a b", province: "Hà Nội" })).toBe("name:a b|pv:Hà Nội");
    expect(buildSourceDedupKey({})).toBeNull();
  });
});
