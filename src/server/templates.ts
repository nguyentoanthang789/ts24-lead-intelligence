// ============================================================
// Module Outreach — Template rendering (pure)
// Quy tắc: biến thiếu dữ liệu → KHÔNG bịa nội dung; trả về danh sách biến thiếu
// Nội dung phải minh bạch người gửi + mục đích; không tuyên bố nhu cầu mua giả
// ============================================================

export const TEMPLATE_VARIABLES = [
  "company_name",
  "business_sector",
  "product_name",
  "verified_business_context",
  "sender_name",
] as const;

export type TemplateContext = {
  company_name?: string | null;
  business_sector?: string | null;
  product_name?: string | null;
  /** Chỉ chứa context CÓ BẰNG CHỨNG — người gọi chịu trách nhiệm chỉ truyền dữ liệu verified */
  verified_business_context?: string | null;
  sender_name?: string | null;
};

export type RenderResult = {
  content: string;
  missingVariables: string[]; // biến có trong template nhưng không có dữ liệu
};

const VAR_RE = /\{([a-zA-Z_]+)\}/g;

export function renderTemplate(body: string, ctx: TemplateContext): RenderResult {
  const missing: string[] = [];
  const content = body.replace(VAR_RE, (_match, rawName: string) => {
    const name = rawName as (typeof TEMPLATE_VARIABLES)[number];
    const value = (ctx as Record<string, string | null | undefined>)[name];
    if (value === undefined || value === null || String(value).trim() === "") {
      if ((TEMPLATE_VARIABLES as readonly string[]).includes(name)) {
        if (!missing.includes(name)) missing.push(name);
      }
      return "";
    }
    return String(value).trim();
  });
  // dọn khoảng trắng thừa, dấu câu dính dòng bỏ biến, và dòng trống liên tiếp
  const cleaned = content
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.!?:;])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content: cleaned, missingVariables: missing };
}

/** Trích danh sách biến có mặt trong template */
export function extractVariables(body: string): string[] {
  const out = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

/**
 * Gợi ý verified_business_context từ bằng chứng đã xác minh — chỉ dùng văn bản từ Evidence,
 * KHÔNG tạo ra nhu cầu/ngoại giao/ lịch sử giao dịch giả.
 */
export function buildVerifiedContext(
  evidences: { kind: string; summary: string; confidence: string; sourceName?: string | null }[],
  sector: string | null,
  province: string | null
): string | null {
  const parts: string[] = [];
  if (sector) parts.push(`hoạt động trong lĩnh vực ${sector}`);
  if (province) parts.push(`tại ${province}`);
  const strong = evidences.filter((e) => e.confidence === "HIGH" || e.confidence === "MEDIUM");
  for (const e of strong.slice(0, 2)) {
    parts.push(e.summary);
  }
  if (parts.length === 0) return null;
  return parts.join("; ");
}
