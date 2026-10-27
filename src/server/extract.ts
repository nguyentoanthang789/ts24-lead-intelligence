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

const TAX_STANDALONE_RE = /\b(\d{10}-\d{3}|\d{13})\b/g;
const PHONE_RE = /(?:\+84|84)?0\d{8,10}\b/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const WEBSITE_RE = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/g;

// bản KHÔNG cờ g để .test() an toàn (không dính lastIndex)
const PHONE_TEST_RE = /^(?:\+84|84)?0\d{8,10}$/;

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
    const phones = uniq((context.match(PHONE_RE) ?? []).map((p) => p.trim())).slice(0, 3);
    const emails = uniq((context.match(EMAIL_RE) ?? []).map((e) => e.trim())).slice(0, 3);
    const web = (context.match(WEBSITE_RE) ?? [])[0];
    if (!taxCode && phones.length === 0 && emails.length === 0) continue; // không đủ dữ liệu liên hệ — bỏ
    const obj: ImportRow = { name };
    if (taxCode) obj.taxCode = taxCode;
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

// ---------------- Entry point chính ----------------

export type ExtractResult = {
  rows: ImportRow[];
  nextLinks: string[];
  via: "table" | "text" | "json" | "none";
};

/** Trích doanh nghiệp từ 1 trang HTML — bảng trước, văn bản sau */
export function extractCompaniesFromHtml(html: string, baseUrl: string): ExtractResult {
  const rows: ImportRow[] = [];
  let via: ExtractResult["via"] = "none";
  for (const grid of extractTables(html)) {
    const r = gridToRows(grid);
    if (r.length > rows.length) {
      rows.length = 0;
      rows.push(...r);
      via = "table";
    }
  }
  if (rows.length === 0) {
    const t = extractCompaniesFromText(htmlToText(html));
    if (t.length > 0) {
      rows.push(...t);
      via = "text";
    }
  }
  return { rows, nextLinks: extractNextLinks(html, baseUrl), via };
}
