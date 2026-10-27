// ============================================================
// Module 5 — Identity Resolution & Deduplication
// Thứ tự đối chiếu: MST đã xác minh > domain > phone chuẩn hóa > nameKey + tỉnh
// Nguyên tắc: KHÔNG tự gộp khi chỉ tên gần giống; unsure → hàng đợi xem xét
// ============================================================

import { buildNameKey } from "./normalization";

export type DedupCandidate = {
  id: string;
  taxCode: string | null;
  taxCodeStatus: string | null;
  domain: string | null;
  province: string | null;
  nameKey: string | null;
  phoneNumbers: string[]; // các ContactPoint type=PHONE đã chuẩn hóa
};

export type MatchResult =
  | { type: "TAX_CODE"; confidence: "HIGH"; companyId: string }
  | { type: "DOMAIN"; confidence: "HIGH"; companyId: string }
  | { type: "PHONE"; confidence: "MEDIUM"; companyId: string }
  | { type: "NAME_PROVINCE"; confidence: "MEDIUM"; companyId: string }
  | { type: "NONE"; confidence: "LOW"; companyId: null };

/**
 * So khớp một bản ghi chuẩn hóa với danh sách doanh nghiệp hiện có.
 * - MST trùng khớp chính xác → gộp chắc chắn (HIGH)
 * - Domain trùng → gộp chắc chắn (HIGH)
 * - Phone trùng → ứng viên mạnh (MEDIUM) → gộp (vì phone đã chuẩn hóa từ kênh công khai)
 * - nameKey + cùng tỉnh → chỉ gộp khi nameKey TRÙNG KHỚP CHÍNH XÁC; khác tỉnh → không gộp
 */
export function matchCompany(
  incoming: {
    taxCode: string | null;
    domain: string | null;
    phones: string[];
    nameKey: string | null;
    province: string | null;
  },
  candidates: DedupCandidate[]
): MatchResult {
  if (incoming.taxCode) {
    const hit = candidates.find(
      (c) => c.taxCode && c.taxCode === incoming.taxCode
    );
    if (hit) return { type: "TAX_CODE", confidence: "HIGH", companyId: hit.id };
  }
  if (incoming.domain) {
    const hit = candidates.find((c) => c.domain && c.domain === incoming.domain);
    if (hit) return { type: "DOMAIN", confidence: "HIGH", companyId: hit.id };
  }
  if (incoming.phones.length > 0) {
    const hit = candidates.find((c) =>
      c.phoneNumbers.some((p) => incoming.phones.includes(p))
    );
    if (hit) return { type: "PHONE", confidence: "MEDIUM", companyId: hit.id };
  }
  if (incoming.nameKey && incoming.province) {
    // chỉ gộp khi nameKey trùng CHÍNH XÁC và CÙNG tỉnh
    const hit = candidates.find(
      (c) =>
        c.nameKey &&
        c.nameKey === incoming.nameKey &&
        c.province &&
        c.province === incoming.province
    );
    if (hit) return { type: "NAME_PROVINCE", confidence: "MEDIUM", companyId: hit.id };
  }
  return { type: "NONE", confidence: "LOW", companyId: null };
}

/**
 * Xác định trường hợp KHÔNG CHẮC CHẮN để đưa vào hàng đợi xem xét:
 * - có nameKey nhưng khác tỉnh so với ứng viên cùng tên
 * - tên trùng một phần nhưng thiếu tỉnh/mst/domain/phone
 */
export function needsManualReview(incoming: {
  taxCode: string | null;
  domain: string | null;
  phones: string[];
  nameKey: string | null;
  province: string | null;
}, candidates: DedupCandidate[]): { review: boolean; reason?: string } {
  // bản ghi đã có định danh mạnh riêng (MST/domain) → định danh đã xác lập,
  // tên gần giống chỉ là trùng danh xưng → không đưa vào hàng đợi xem xét
  const hasStrongId = !!(incoming.taxCode || incoming.domain);
  if (!hasStrongId && incoming.nameKey) {
    const sameNameDifferentProvince = candidates.find(
      (c) => c.nameKey && c.nameKey === incoming.nameKey && incoming.province && c.province && c.province !== incoming.province
    );
    if (sameNameDifferentProvince) {
      return {
        review: true,
        reason: "Trùng nameKey nhưng khác tỉnh — cần xem xét thủ công trước khi gộp",
      };
    }
  }
  if (!hasStrongId && incoming.phones.length === 0 && incoming.nameKey) {
    const partial = candidates.find(
      (c) => c.nameKey && c.nameKey.includes(incoming.nameKey!) && c.nameKey !== incoming.nameKey
    );
    if (partial) {
      return {
        review: true,
        reason: "Thiếu MST/domain/phone — tên tương tự ứng viên hiện có, cần xác minh",
      };
    }
  }
  return { review: false };
}

/** Tạo dedupKey cho SourceRecord để chống trùng lặp trong cùng nguồn */
export function buildSourceDedupKey(input: {
  taxCode?: string | null;
  domain?: string | null;
  nameKey?: string | null;
  province?: string | null;
}): string | null {
  if (input.taxCode) return `tax:${input.taxCode}`;
  if (input.domain) return `dom:${input.domain}`;
  if (input.nameKey && input.province) return `name:${input.nameKey}|pv:${input.province}`;
  if (input.nameKey) return `name:${input.nameKey}`;
  return null;
}

export { buildNameKey };
