// ============================================================
// Module 14 — Generic Extractor: trích xuất doanh nghiệp THẬT từ
// HTML/JSON công khai của nguồn ĐÃ ĐƯỢC PHÉP (accessPolicy=ALLOWED).
//
// Nguyên tắc:
// - CHỈ lấy dữ liệu hiển thị công khai trên trang — không bịa, không suy diễn.
// - Ưu tiên bảng có header rõ (map qua FIELD_ALIASES của pipeline).
// - Không có bảng → quét khối văn bản theo dấu hiệu doanh nghiệp VN
//   (công ty/tnhh/cổ phần...) + MST/phone/email CÓ TRÊN trang.
// - Không vượt chống bot: adapter gọi module này chỉ sau khi robots OK.
// - Pure functions — unit test được, không đụng DB/mạng.
// ============================================================

import { FIELD_ALIASES } from "./import-pipeline";
import { ImportRow } from "./import-pipeline";

// ---------------- HTML utilities (pure) ----------------

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", raquo: "»", laquo: "«", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", middot: "·", bull: "•",
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => {
      const code = parseInt(h, 16);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_m, d) => {
      const code = parseInt(d, 10);
      return code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

/** Bỏ tag → text; tag khối xuống dòng để giữ ranh giới khối */
export function stripTags(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|article|header|footer|ul|ol|dl|dd|dt)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    ;
}

export function htmlToText(html: string): string {
  return decodeEntities(stripTags(html)).replace(/[ \t\r\f\v]+/g, " ").replace(/\n{2,}/g, "\n");
}

/** Bỏ dấu tiếng Việt + lowercase — dùng để so khớp header/từ khóa */
export function deaccent(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function normHeader(s: string): string {
  return deaccent(s).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Đổi cell header → tên trường chuẩn của pipeline (null nếu không nhận ra) */
export function canonicalFieldFromHeader(raw: string): string | null {
  const h = normHeader(raw);
  if (!h) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(h)) return field;
  }
  // một số header kiểu "Mã số thuế (MST)", "Điện thoại liên hệ"
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) {
      if (a.length >= 3 && (h.includes(a) || a.includes(h))) return field;
    }
  }
  return null;
}

// ---------------- Regex nhận diện ----------------

export const COMPANY_KEYWORDS = [
  "cong ty", "cty", "tnhh", "co phan", "doanh nghiep", "ho kinh doanh", "hop tac xa",
  "htx", "xuong san xuat", "nha hang", "khach san", "cua hang", "van phong", "chi nhanh",
  "tru so", "company", "corporation", "co.,", "ltd", "joint stock", "enterprise",
];

const TAX_KEYWORD_RE = /(?:mst|ma[_\s]*so[_\s]*thue|tax[_\s]*code|taxcode|gpkd|giay[_\s]*phep[_\s]*kinh[_\s]*doanh|vat[_\s]*code|ma[_\s]*so[_\s]*dn|tax[_\s]*id|fiscal[_\s]*code)[^0-9]{0,12}(\d{10}(?:-\d{3})?|\d{13})/gi;

// Tên người liên lạc / người đại diện trong văn bản: "Người đại diện theo pháp luật là Nguyễn Văn A",
// "Người đại diện: Trần Thị B", "Người ĐDPL: Lê Văn C" — bắt trên bản có dấu,
// sau đó làm sạch + chống nhãn tràn vào (dừng trước nhãn khác/SĐT/MST).
const CONTACT_NAME_RE = /người\s*(?:đại\s*diện|đdpl|dại\s*diện)\s*(?:theo\s*pháp\s*luật)?\s*(?:là|:|-|–)?\s*([A-Za-zÀ-ỹĐđ][A-Za-zÀ-ỹĐđ\s.]{1,60})/i;
// CHÚ Ý: \b trong JS chỉ nhìn \w ASCII — "ỉ/ọ/ị" không phải \w nên \b SAU nhãn
// tiếng Việt luôn fail. Dùng lookahead "không phải chữ" thay thế.
const CONTACT_LABEL_TAIL_RE = /^(địa\s*chỉ|mã\s*số\s*thuế|mst|điện\s*thoại|sđt|email|ngành|tình\s*trạng|tên\s*đơn\s*vị)$/i;
const CONTACT_STOP_RE = /\s+(?:địa\s*chỉ|mã\s*số\s*thuế|mst\b|điện\s*thoại|sđt|email|ngành|tình\s*trạng)(?=\s|:|$)/i;

const TAX_STANDALONE_RE = /\b(\d{10}-\d{3}|\d{13})\b/g;
const PHONE_RE = /(?:\+84|84)?0\d{8,10}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const WEBSITE_RE = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/g;

// bản KHÔNG cờ g để .test() an toàn (không dính lastIndex)
const PHONE_TEST_RE = /^(?:\+84|84)?0\d{8,10}$/;
const EMAIL_TEST_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function cleanName(s: string): string {
  return s
    .replace(/^[\s\-–—•*·>#\d.)\]]+/, "") // bullet/đánh số đầu dòng
    .replace(/\s{2,}/g, " ")
    .replace(/[|;]+$/, "")
    .trim()
    .slice(0, 160);
}

function looksLikeCompany(text: string): boolean {
  const t = deaccent(text);
  return COMPANY_KEYWORDS.some((k) => t.includes(k));
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Bắt tên người đại diện/người liên lạc từ dòng văn bản (nếu có).
 * Trả về tên đã làm sạch hoặc null — KHÔNG suy diễn khi không khớp rõ.
 */
export function extractContactName(text: string): string | null {
  const m = CONTACT_NAME_RE.exec(text);
  if (!m) return null;
  let name = m[1].replace(/\s{2,}/g, " ").trim();
  // cắt khi đụng nhãn kế tiếp trong cùng dòng ("Người đại diện: A Địa chỉ: X")
  const stop = CONTACT_STOP_RE.exec(name);
  if (stop) name = name.slice(0, stop.index).trim();
  // mỗi từ ≥ 1 ký tự, không phải nhãn — chặn "Người đại diện: tra cứu"
  const words = name.split(" ").filter(Boolean);
  if (words.length < 2 || words.length > 6) return null;
  if (words.some((w) => CONTACT_LABEL_TAIL_RE.test(w))) return null;
  return cleanContactNameField(name);
}

function cleanContactNameField(s: string): string {
  return s
    .replace(/^[\s\-–—:;,]+/, "")
    .replace(/[\s\-–—:;,.]+$/, "") // dấu chấm cuối là kết câu, không thuộc tên người
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 80);
}

// ---------------- Bảng HTML → rows ----------------

/** Tách các bảng HTML thành lưới cell (bỏ bảng lồng nhau trùng) */
export function extractTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  const raw: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) raw.push(m[1]);
  for (const body of raw) {
    if (/<table\b/i.test(body)) {
      // bảng lồng — đệ quy vào phần trong, bỏ vỏ ngoài
      tables.push(...extractTables(body));
      continue;
    }
    const grid: string[][] = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(body)) !== null) {
      const cells: string[] = [];
      const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let td: RegExpExecArray | null;
      while ((td = tdRe.exec(tr[1])) !== null) {
        cells.push(decodeEntities(stripTags(td[1])).replace(/\s+/g, " ").trim());
      }
      if (cells.length > 0) grid.push(cells);
    }
    if (grid.length > 0) tables.push(grid);
  }
  return tables;
}

/** Lưới → ImportRow[]: ưu tiên dòng header map FIELD_ALIASES; không có header → heuristic từng dòng */
export function gridToRows(grid: string[][], rowIndex = 0): ImportRow[] {
  // tìm dòng header: ≥2 cell nhận ra là trường chuẩn
  let headerIdx = -1;
  let fieldMap: (string | null)[] = [];
  for (let i = rowIndex; i < Math.min(grid.length, 5); i++) {
    const fields = grid[i].map(canonicalFieldFromHeader);
    const hits = fields.filter(Boolean).length;
    if (hits >= 2) {
      headerIdx = i;
      fieldMap = fields;
      break;
    }
  }
  const rows: ImportRow[] = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < grid.length; i++) {
      const obj: ImportRow = {};
      for (let j = 0; j < grid[i].length && j < fieldMap.length; j++) {
        const f = fieldMap[j];
        const v = grid[i][j];
        if (!f || !v) continue;
        obj[f] = obj[f] ? `${obj[f]}; ${v}` : v;
      }
      if (Object.keys(obj).length > 0) rows.push(obj);
    }
    return rows;
  }
  // heuristic không header: mỗi dòng là 1 ứng viên nếu nhận ra tên + liên hệ
  for (let i = rowIndex; i < grid.length; i++) {
    const row = heuristicRow(grid[i]);
    if (row) rows.push(row);
  }
  return rows;
}

function heuristicRow(cells: string[]): ImportRow | null {
  const joined = cells.join(" | ");
  if (!looksLikeCompany(joined)) return null;
  const name = cleanName(cells.slice().sort((a, b) => b.length - a.length).find((c) => looksLikeCompany(c)) ?? "");
  const taxIdx = cells.findIndex((c) => /^\d{10}(-\d{3})?$/.test(c.trim()) || /^\d{13}$/.test(c.trim()));
  // phone: chọn cell KHÁC cell MST đã chọn (tránh lấy nhầm MST làm phone)
  const phoneIdx = cells.findIndex((c, i) => i !== taxIdx && PHONE_TEST_RE.test(c.trim()));
  const emailCell = cells.find((c) => EMAIL_RE.test(c));
  if (!name || (taxIdx < 0 && phoneIdx < 0 && !emailCell)) return null;
  const obj: ImportRow = {};
  if (name) obj.name = name;
  if (taxIdx >= 0) obj.taxCode = cells[taxIdx].trim();
  if (phoneIdx >= 0) obj.phone = cells[phoneIdx].trim();
  if (emailCell) obj.email = emailCell.trim();
  return obj;
}

// ---------------- Khối văn bản → rows (trang danh bạ dạng chữ) ----------------

/**
 * Quét dòng văn bản: dòng có dấu hiệu DN = mốc; nhìn trước tối đa 3 dòng kế
 * để bắt MST/phone/email (cấu trúc phổ biến của danh bạ: tên DN xuống dòng
 * thông tin liên hệ). Không đủ dữ liệu liên hệ → bỏ, không bịa.
 */
export function extractCompaniesFromText(text: string, maxRows = 2000): ImportRow[] {
  const lines = text.split("\n").map((l) => l.trim());
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < lines.length && rows.length < maxRows) {
    const line = lines[i];
    i++;
    if (!line || line.length < 8 || line.length > 400) continue;
    if (!looksLikeCompany(line)) continue;
    const name = cleanName(line.split(/[|·]/)[0] ?? line);
    if (!name || !looksLikeCompany(name)) continue;
    const nameKey = deaccent(name).replace(/[^a-z0-9]+/g, "");
    if (seen.has(nameKey)) continue;
    // ngữ cảnh: dòng hiện tại + tối đa 3 dòng kế (không qua dòng trống thứ 2)
    const ctxLines: string[] = [line];
    let blanks = 0;
    for (let j = i; j < lines.length && ctxLines.length < 4; j++) {
      const l = lines[j];
      if (!l) {
        blanks++;
        if (blanks >= 1) break;
        continue;
      }
      if (looksLikeCompany(l)) break; // gặp DN khác — dừng ngữ cảnh
      ctxLines.push(l);
    }
    const context = ctxLines.join(" \n ");
    const de = deaccent(context);
    let taxCode = "";
    let km: RegExpExecArray | null;
    TAX_KEYWORD_RE.lastIndex = 0;
    if ((km = TAX_KEYWORD_RE.exec(de)) !== null) taxCode = km[1];
    if (!taxCode) {
      const st = context.match(TAX_STANDALONE_RE);
      if (st && st.length === 1) taxCode = st[0]; // chỉ nhận khi duy nhất — tránh lấy nhầm số khác
    }
    const contactName = extractContactName(context); // "Người đại diện..." → tên người liên lạc
    const phones = uniq((context.match(PHONE_RE) ?? []).map((p) => p.trim())).slice(0, 3);
    const emails = uniq((context.match(EMAIL_RE) ?? []).map((e) => e.trim())).slice(0, 3);
    const web = (context.match(WEBSITE_RE) ?? [])[0];
    if (!taxCode && phones.length === 0 && emails.length === 0) continue; // không đủ dữ liệu liên hệ — bỏ
    const obj: ImportRow = { name };
    if (taxCode) obj.taxCode = taxCode;
    if (contactName) obj.contactName = contactName;
    if (phones.length) obj.phone = phones.join("; ");
    if (emails.length) obj.email = emails.join("; ");
    if (web) obj.website = web;
    rows.push(obj);
    seen.add(nameKey);
    i += ctxLines.length - 1; // bỏ qua các dòng đã dùng làm ngữ cảnh
  }
  return rows;
}

// ---------------- JSON API → rows ----------------

function findObjectArrays(v: unknown, depth: number, out: Record<string, unknown>[][]): void {
  if (depth > 3 || v === null || typeof v !== "object") return;
  if (Array.isArray(v)) {
    const objs = v.filter((x) => x !== null && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
    if (objs.length > 0) out.push(objs);
    for (const item of v) findObjectArrays(item, depth + 1, out);
    return;
  }
  for (const val of Object.values(v as Record<string, unknown>)) findObjectArrays(val, depth + 1, out);
}

/** Trích doanh nghiệp từ JSON công khai của OFFICIAL_API — map key qua aliases */
export function extractCompaniesFromJson(jsonText: string, maxRows = 5000): ImportRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  const arrays: Record<string, unknown>[][] = [];
  findObjectArrays(parsed, 0, arrays);
  if (arrays.length === 0) return [];
  arrays.sort((a, b) => b.length - a.length); // mảng lớn nhất là danh sách chính
  const best = arrays[0];
  const rows: ImportRow[] = [];
  for (const obj of best) {
    if (rows.length >= maxRows) break;
    const row: ImportRow = {};
    for (const [k, v] of Object.entries(obj)) {
      const field = canonicalFieldFromHeader(k);
      if (!field) continue;
      if (v === null || v === undefined) continue;
      const s = typeof v === "object" ? "" : String(v).trim();
      if (!s) continue;
      row[field] = row[field] ? `${row[field]}; ${s}` : s;
    }
    if (row.name) rows.push(row);
  }
  return rows;
}

// ---------------- Pagination: tìm link trang kế ----------------

const NEXT_TEXT_RE = /^(next|tiếp|tiếp theo|sau|trang sau|trang kế|»|›|>>|>|next page|older)/i;
const PAGE_URL_RE = /(?:[?&](?:page|p|trang|start|offset|currentpage)=(\d+))|(?:\/page\/(\d+))/i;

/** Tìm link trang kế (cùng host — không nhảy sang miền khác), ưu tiên page số liền sau */
export function extractNextLinks(html: string, baseUrl: string, maxLinks = 5): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const curPage = parseInt(PAGE_URL_RE.exec(base.href)?.[1] ?? PAGE_URL_RE.exec(base.href)?.[2] ?? "0", 10) || 0;
  type Cand = { url: string; score: number };
  const cands: Cand[] = [];
  const push = (u: URL, score: number) => {
    u.hash = "";
    if (!cands.some((c) => c.url === u.href)) cands.push({ url: u.href, score });
  };
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && cands.length < maxLinks * 4) {
    const attrs = m[1];
    const inner = m[2];
    const hrefM = /href\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!hrefM) continue;
    const href = decodeEntities(hrefM[1]).trim();
    if (!href || href.startsWith("#") || /^(mailto|javascript|tel):/i.test(href)) continue;
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.host !== base.host) continue; // ở lại cùng nguồn
    const relNext = /rel\s*=\s*["']?next\b/i.test(attrs);
    const text = deaccent(decodeEntities(stripTags(inner)).replace(/\s+/g, " ").trim());
    const textNext = NEXT_TEXT_RE.test(text);
    const pageM = PAGE_URL_RE.exec(abs.href);
    const pageNum = pageM ? parseInt(pageM[1] ?? pageM[2] ?? "0", 10) || 0 : 0;
    if (relNext || textNext) push(abs, 0);
    else if (pageM && pageNum > curPage) push(abs, 1); // ưu tiên trang số liền sau trang hiện tại
    else if (pageM) push(abs, 2);
  }
  cands.sort((a, b) => a.score - b.score);
  return cands.slice(0, maxLinks).map((c) => c.url);
}

// ---------------- Bảng hồ sơ DỌC (label → value, 1 DN mỗi trang) ----------------

/**
 * Map nhãn hồ sơ → trường chuẩn, CHẾ ĐỘ NGHIÊM: chỉ nhận alias khớp nguyên
 * hoặc substring khi alias đủ dài (≥6) — tránh "Tên viết tắt"/"Tên giao dịch"
 * bị nhận nhầm thành tên doanh nghiệp.
 */
export function verticalStrictField(raw: string): string | null {
  const h = normHeader(raw);
  if (!h) return null;
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(h)) return field;
  }
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const a of aliases) {
      if (a.length >= 6 && (h.includes(a) || a.includes(h))) return field;
    }
  }
  return null;
}

/** Tỷ lệ dòng nhãn-hợp-le tối thiểu để coi bảng là hồ sơ dọc */
const VERTICAL_MIN_HITS = 3;

/** Nhãn giao diện trang hay tràn vào giá trị hồ sơ — loại bỏ, KHÔNG phải dữ liệu DN */
const UI_LABEL_PARTS = /^(thong tin xuat hoa don|thong tin ma so thue|sao chep( tat ca| ma so thue)?|mo trang goc|hien so|tra cuu ho so sdt)$/;

/** Bảng dọc kiểu "Mã số thuế | 0101248141" → 1 record (name có thể điền sau từ h1) */
export function verticalProfileFromGrid(grid: string[][]): ImportRow | null {
  if (grid.length < VERTICAL_MIN_HITS) return null;
  let hits = 0;
  for (const row of grid) {
    if (row.length >= 2 && verticalStrictField(row[0])) hits++;
  }
  // hồ sơ dọc thật: ≥3 dòng nhãn hợp lệ và ≥30% bảng (trang chi tiết thường lẫn
  // vài nhãn không map: "Người đại diện", "Ngày cấp"... — vẫn là hồ sơ)
  if (hits < VERTICAL_MIN_HITS || hits < Math.ceil(grid.length * 0.3)) return null;
  const obj: ImportRow = {};
  for (const row of grid) {
    if (row.length < 2) continue;
    const f = verticalStrictField(row[0]);
    if (!f) continue;
    // loại phần nhãn UI tràn vào giá trị (độc lập hoặc dính trong cell); địa chỉ CHỈ nhận giá trị đầu (địa chỉ mới thắng địa chỉ cũ)
    const parts = row.slice(1).filter(Boolean).map((p) => p.trim())
      .map((p) => p.replace(/\s*(?:Thông tin xuất hóa đơn|Thông tin mã số thuế|Sao chép mã số thuế|Sao chép tất cả|Sao chép|Mở trang gốc|Hiện số)\s*/gi, " ").replace(/\s{2,}/g, " ").trim())
      .filter((p) => p && !UI_LABEL_PARTS.test(deaccent(p)));
    // tên + địa chỉ: CHỈ ô đầu tiên trong hàng (né dán thêm shortName/tỉnh/người đại diện;
    // địa chỉ mới thắng địa chỉ cũ). Trường khác (SĐT, email...) ghép nhiều ô.
    const v = (f === "name" || f === "address") ? (parts[0] ?? "") : parts.join("; ").trim();
    if (!v) continue;
    if (f === "name" && obj.name) continue;
    obj[f] = obj[f] ? `${obj[f]}; ${v}` : v;
  }
  return Object.keys(obj).length >= 2 ? obj : null;
}

/**
 * Cặp div kiểu data-row (EuroCham profile):
 * <div class="data-row"><div class="data-row-heading"><h4>Company Name</h4></div>
 * <div class="data-row-value">A.R.E.N.A. Vietnam</div></div>
 */
export function verticalProfileFromDataRows(html: string): ImportRow | null {
  const re =
    /data-row-heading[^>]*>\s*(?:<h\d[^>]*>)?([\s\S]*?)(?:<\/h\d>)?\s*<\/div>\s*<div[^>]*data-row-value[^>]*>([\s\S]*?)<\/div>/gi;
  const obj: ImportRow = {};
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const k = decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim();
    const v = decodeEntities(stripTags(m[2])).replace(/\s+/g, " ").trim();
    if (!k || !v) continue;
    const f = verticalStrictField(k);
    if (!f) continue;
    count++;
    obj[f] = obj[f] ? `${obj[f]}; ${v}` : v;
  }
  return count >= VERTICAL_MIN_HITS ? obj : null;
}

/**
 * Thẻ thành viên có email gắn trên thuộc tính (danh bạ kiểu EuroCham):
 * <a class="mdapi-member" data-mail="x@y.z">...<div class="mdapi-member__title">Công ty</div></a>
 * → row { name, email } — tên lấy từ khối chữ trong anchor.
 */
export function extractMembersWithDataMail(html: string, maxRows = 2000): ImportRow[] {
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && rows.length < maxRows) {
    const mailM = /data-(?:mail|email)\s*=\s*["']([^"']+)["']/i.exec(m[1]);
    if (!mailM) continue;
    const email = decodeEntities(mailM[1]).trim();
    if (!EMAIL_TEST_RE.test(email)) continue;
    const inner = decodeEntities(stripTags(m[2]));
    const name =
      inner
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 4 && !l.includes("@") && !/^(xem|chi tiết|view|more|details)$/i.test(l))[0] ?? "";
    if (!name || name.length > 160) continue;
    const key = deaccent(name).replace(/[^a-z0-9]+/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, email });
  }
  return rows;
}

/** H1/tiêu đề trang hồ sơ: "CÔNG TY CỔ PHẦN FPT - MST 0101248141 | ..." hoặc
 *  "0101248141 - CÔNG TY FPT | ..." → tên + MST. Tên không cần từ khóa DN khi
 *  tiêu đề kèm MST (trang hồ sơ xác định DN theo MST — trường học, HTX... vẫn hợp lệ). */
export function extractHeadingName(html: string): { name: string; taxCode: string } | null {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  let text = h1 ? decodeEntities(stripTags(h1)).replace(/\s+/g, " ").trim() : "";
  if (!text) {
    const t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    text = t ? decodeEntities(t).replace(/\s+/g, " ").trim() : "";
  }
  if (!text) return null;
  let s = text.split("|")[0].trim();
  let taxCode = "";
  // dạng 1: "Tên - MST 0101248141"
  const mM = /[-–—]\s*MST\s*:?\s*(\d{10}(?:-\d{3})?|\d{13})/i.exec(s);
  if (mM) {
    taxCode = mM[1];
    s = s.slice(0, mM.index).trim();
  }
  // dạng 2: "0101248141 - Tên" (tracuumst)
  const pM = /^(\d{10}(?:-\d{3})?|\d{13})\s*[-–—]\s*/.exec(s);
  if (pM) {
    taxCode = taxCode || pM[1];
    s = s.slice(pM[0].length).trim();
  }
  const name = s.replace(/[\s\-–—]+$/, "").trim();
  if (!name || !isPlausibleName(name)) return null;
  // không có MST → cần dấu hiệu DN rõ; có MST → tên hiển thị trên trang hồ sơ là đủ
  if (!taxCode && !looksLikeCompany(name)) return null;
  return { name, taxCode };
}

// ---------------- Sitemap XML ----------------

/** Đọc <loc> từ sitemap.xml — phân biệt sitemapindex và urlset */
export function extractSitemapLocs(xml: string): { kind: "sitemapindex" | "urlset"; locs: string[] } {
  const kind = /<sitemapindex\b/i.test(xml) ? "sitemapindex" : "urlset";
  const locs: string[] = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) locs.push(decodeEntities(m[1]).trim());
  return { kind, locs };
}

// ---------------- Lọc chất lượng tên ----------------

/** Tên doanh nghiệp hợp lệ: không phải URL, không phải câu hỏi FAQ, không phải nhãn liên hệ / điều hướng trang */
export function isPlausibleName(n: string): boolean {
  const t = n.trim();
  if (!t || t.length < 4 || t.length > 200) return false;
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) return false;
  if (/^(số điện thoại|hotline|liên hệ|tel[:\s]|phone|email|địa chỉ|tra cứu|tìm kiếm|trang chủ|xem thêm|chi tiết|đăng nhập|đăng ký|menu|bỏ qua)/i.test(t)) return false;
  if (/[?？]\s*$/.test(t)) return false; // câu hỏi FAQ kiểu "… là của công ty nào?"
  return true;
}

/** Cắt đuôi "MST: 0108945612 Đang HĐ" / "- MST 0108945612" khỏi tên — MST là trường riêng, không nằm trong tên */
export function cleanCompanyName(n: string): string {
  const mM = /\s*(?:[-–—]\s*)?MST\s*:?\s*\d{10}(?:-\d{3})?[\s\S]*$/i.exec(n);
  if (mM) return n.slice(0, mM.index).replace(/[\s\-–—]+$/, "").trim();
  return n.trim();
}

/**
 * Thẻ danh bạ kiểu tracuumst (.tc-item): 1 khối div = 1 DN với tên + MST +
 * Người đại diện + Địa chỉ — cấu trúc lặp nên parse bằng khối, KHÔNG bịa
 * trường thiếu. Trả về tối đa maxRows thẻ hợp lệ.
 */
export function extractDirectoryCards(html: string, maxRows = 500): ImportRow[] {
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  // ranh giới khối: mở đầu bằng tc-item__name, kết thúc trước tc-item__name kế
  const re = /<div\s+class="tc-item__name"[^>]*>([\s\S]*?)<\/div>([\s\S]*?)(?=<div\s+class="tc-item__name"|<\/div>\s*<\/div>\s*$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && rows.length < maxRows) {
    const name = cleanName(decodeEntities(stripTags(m[1])).replace(/\s+/g, " ").trim());
    if (!name || !isPlausibleName(name)) continue;
    // parse TỪNG hàng nhãn riêng (<p class="tc-item__row">) — giá trị không tràn qua nhãn khác
    const rowRe = /<p\s+class="tc-item__row"[^>]*>([\s\S]*?)<\/p>/gi;
    let taxCode = "";
    let contactName: string | null = null;
    let address = "";
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(m[2])) !== null) {
      const rowText = decodeEntities(stripTags(rm[1])).replace(/\s+/g, " ").trim();
      const de = deaccent(rowText);
      if (!taxCode) {
        const tM = /ma so thue:\s*(\d{10}(?:-\d{3})?|\d{13})/i.exec(de);
        if (tM) taxCode = tM[1];
      }
      if (!contactName) {
        const cM = /^Người đại diện:\s*(.+)$/i.exec(rowText);
        if (cM) contactName = cleanContactNameField(cM[1]);
      }
      if (!address) {
        const aM = /^Địa chỉ:\s*(.+)$/i.exec(rowText);
        if (aM) address = aM[1].trim();
      }
    }
    if (!taxCode && !contactName) continue; // thiếu cả định danh lẫn liên hệ — thẻ rác, bỏ
    const key = (taxCode || deaccent(name).replace(/[^a-z0-9]+/g, "")).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const row: ImportRow = { name };
    if (taxCode) row.taxCode = taxCode;
    if (contactName) row.contactName = contactName;
    if (address) row.address = address.slice(0, 300);
    rows.push(row);
  }
  return rows;
}

// ---------------- Entry point chính ----------------

export type ExtractResult = {
  rows: ImportRow[];
  nextLinks: string[];
  via: "table" | "text" | "json" | "none" | "profile" | "members" | "cards";
};

/** Trích doanh nghiệp từ 1 trang HTML — hồ sơ dọc trước (trang chi tiết) → bảng ngang → member card → văn bản */
export function extractCompaniesFromHtml(html: string, baseUrl: string): ExtractResult {
  const rows: ImportRow[] = [];
  let via: ExtractResult["via"] = "none";
  // HỒ SƠ DỌC TRƯỚC: trang chi tiết DN chứa cả bảng phụ (FAQ, DN liên quan) —
  // ưu tiên hồ sơ dọc giúp né rác từ các bảng phụ đó.
  for (const grid of extractTables(html)) {
    const vp = verticalProfileFromGrid(grid);
    if (vp) {
      rows.push(vp);
      via = "profile";
      break;
    }
  }
  if (rows.length === 0) {
    const vp = verticalProfileFromDataRows(html);
    if (vp) {
      rows.push(vp);
      via = "profile";
    }
  }
  // Hồ sơ dọc chưa có tên (bảng profile không chứa tên) → lấy từ h1/title
  // PHẢI LÀM TRƯỚC KHI THÊM THẺ — nếu không điều kiện rows.length===1 sẽ chết;
  // chỉ nhận khi hồ sơ có ≥1 trường liên hệ thật (MST/SĐT/email/người đại diện)
  if (rows.length === 1 && !rows[0].name && (rows[0].taxCode || rows[0].phone || rows[0].email || rows[0].contactName)) {
    const head = extractHeadingName(html);
    if (head) {
      rows[0].name = head.name;
      if (!rows[0].taxCode && head.taxCode) rows[0].taxCode = head.taxCode;
    }
  }
  // THẺ DANH BẠ (.tc-item) — chạy SONG SONG với hồ sơ dọc: mỗi trang hồ sơ
  // tracuumst thường kèm ~8 DN liên quan (tên + MST + người đại diện + địa chỉ).
  // Khử trùng lặp với hồ sơ chính theo MST/tên đã chuẩn hóa.
  if (rows.length > 0) {
    const existingKeys = new Set(
      rows.map((r) => (r.taxCode ?? deaccent(r.name ?? "").replace(/[^a-z0-9]+/g, "")).toLowerCase()),
    );
    const cards = extractDirectoryCards(html).filter((c) => {
      const k = (c.taxCode ?? deaccent(c.name ?? "").replace(/[^a-z0-9]+/g, "")).toLowerCase();
      if (!k || existingKeys.has(k)) return false;
      existingKeys.add(k);
      return true;
    });
    if (cards.length > 0) {
      rows.push(...cards);
      if (via === "none") via = "cards";
    }
  }
  // Bảng ngang kiểu danh sách (nhiều DN mỗi trang)
  if (rows.length === 0) {
    for (const grid of extractTables(html)) {
      const r = gridToRows(grid);
      if (r.length > rows.length) {
        rows.length = 0;
        rows.push(...r);
        via = "table";
      }
    }
    const namedRows = rows.filter((r) => r.name && r.name.trim());
    if (via === "table" && namedRows.length === 0) {
      rows.length = 0;
      via = "none";
    } else if (via === "table") {
      rows.length = 0;
      rows.push(...namedRows);
    }
  }
  // Thẻ thành viên data-mail (danh bạ member)
  if (rows.length === 0) {
    const mem = extractMembersWithDataMail(html);
    if (mem.length > 0) {
      rows.push(...mem);
      via = "members";
    }
  }
  if (rows.length === 0) {
    const t = extractCompaniesFromText(htmlToText(html));
    if (t.length > 0) {
      rows.push(...t);
      via = "text";
    }
  }
  // 1 hồ sơ chưa có tên ở đường TABLE/MEMBERS/TEXT (profile đã xử lý ở trên)
  if (rows.length === 1 && !rows[0].name && (rows[0].taxCode || rows[0].phone || rows[0].email)) {
    const head = extractHeadingName(html);
    if (head) {
      rows[0].name = head.name;
      if (!rows[0].taxCode && head.taxCode) rows[0].taxCode = head.taxCode;
    }
  }
  // cổng chất lượng: tên hợp lệ + cắt đuôi MST + chặn phone=MST + SĐT bẩn (che ***)
  const clean = rows
    .map((r) => {
      const row = { ...r };
      if (row.name) row.name = cleanCompanyName(row.name);
      if (row.phone && row.taxCode && row.phone.replace(/\D/g, "") === row.taxCode.replace(/\D/g, "")) {
        delete row.phone; // MST bị nhầm thành SĐT — xóa, không suy diễn
      }
      // SĐT lẫn chữ trang trí ("0977 *** *** Hiện số Tra cứu...") → chỉ giữ số điện thoại thật
      if (row.phone && /[^0-9;\s+]/.test(row.phone)) {
        const real = uniq((row.phone.match(PHONE_RE) ?? []).map((p) => p.replace(/[^0-9+]/g, ""))).slice(0, 3);
        if (real.length > 0) row.phone = real.join("; ");
        else delete row.phone; // không có số hợp lệ — bỏ ô, không giữ rác
      }
      return row;
    })
    .filter((r) => r.name && isPlausibleName(r.name));
  return { rows: clean, nextLinks: extractNextLinks(html, baseUrl), via };
}
