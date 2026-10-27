// ============================================================
// Module 4 — Data Normalization (pure functions, testable)
// Chuẩn hóa: tên DN, mã số thuế, phone VN, domain, tỉnh/thành, ngành nghề
// Nguyên tắc: giữ giá trị gốc ở SourceRecord.payload; không tự điền dữ liệu suy đoán
// ============================================================

/** Bỏ dấu tiếng Việt */
export function removeDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

/** Chuẩn hóa mã số thuế: chỉ giữ số, chấp nhận 10 số hoặc 13 số (mst + chi nhánh) */
export function normalizeTaxCode(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 13) return digits; // MST chi nhánh 10 + 3 số
  return null; // sai định dạng → không đoán
}

/** Kiểm tra checksum MST VN (10 số) theo thuật toán chính thức */
export function isValidTaxCode(taxCode: string): boolean {
  const t = normalizeTaxCode(taxCode);
  if (!t || t.length !== 10) return false;
  const coeff = [31, 29, 23, 19, 17, 13, 7, 5, 3];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(t[i], 10) * coeff[i];
  const check = sum % 11;
  const last = parseInt(t[9], 10);
  return check === 10 ? last === 0 : check === last;
}

/** Chuẩn hóa số điện thoại VN về dạng 84xxxxxxxxx; trả null nếu sai */
export function normalizePhoneVN(raw?: string | null): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0084")) digits = "84" + digits.slice(4);
  else if (digits.startsWith("84")) {
    // giữ nguyên
  } else if (digits.startsWith("0")) digits = "84" + digits.slice(1);
  else return null; // phải bắt đầu 0/84/0084 để là số VN
  if (digits.length < 11 || digits.length > 12) return null;
  const local = digits.slice(2);
  if (!/^[23456789]/.test(local)) return null;
  return digits;
}

/** Chuẩn hóa website/domain: lowercase, bỏ protocol, www., path, port, trailing slash */
export function normalizeDomain(raw?: string | null): string | null {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const host = s.split("/")[0].split("?")[0].split(":")[0];
  if (!host || !host.includes(".") || /\s/.test(host)) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // không nhận IP trần
  return host;
}

const LEGAL_START_PHRASES = [
  "cong ty co phan", "cong ty tnhh", "cong ty", "cty co phan", "cty tnhh",
  "cty cp", "cty", "doanh nghiep tu nhan", "chi nhanh", "van phong dai dien",
  "ctcp", "tnhh mtv", "tnhh mtv", "dntn",
];
const LEGAL_END_PHRASES = [
  "co phan", "tnhh", "cp", "mtv", "jsc", "ltd", "llc", "inc", "corp",
  "tieu hoi", "xu nghiep", "hop danh", "co., ltd", "vietnam", "viet nam",
];

/** Sinh nameKey: bỏ dấu, bỏ cụm pháp lý (khớp theo CỤM nhiều từ), chữ thường */
export function buildNameKey(raw?: string | null): string | null {
  if (!raw) return null;
  let s = removeDiacritics(String(raw)).toLowerCase();
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  let tokens = s.split(" ");
  let changed = true;
  while (changed && tokens.length > 2) {
    changed = false;
    // thử strip cụm 4 → 3 → 2 → 1 từ ở đầu (ưu tiên cụm dài)
    for (const len of [4, 3, 2, 1]) {
      if (tokens.length > len && LEGAL_START_PHRASES.includes(tokens.slice(0, len).join(" "))) {
        tokens = tokens.slice(len);
        changed = true;
        break;
      }
    }
    if (changed) continue;
    // thử strip cụm ở cuối
    for (const len of [2, 1]) {
      if (tokens.length > len && LEGAL_END_PHRASES.includes(tokens.slice(-len).join(" "))) {
        tokens = tokens.slice(0, -len);
        changed = true;
        break;
      }
    }
  }
  const key = tokens.join(" ").trim();
  return key || null;
}

const PROVINCE_ALIASES: Record<string, string> = {
  "ha noi": "Hà Nội", "hanoi": "Hà Nội", "tp hcm": "TP. Hồ Chí Minh",
  "ho chi minh": "TP. Hồ Chí Minh", "hcm": "TP. Hồ Chí Minh", "sai gon": "TP. Hồ Chí Minh",
  "da nang": "Đà Nẵng", "hai phong": "Hải Phòng", "can tho": "Cần Thơ",
  "binh duong": "Bình Dương", "dong nai": "Đồng Nai", "khanh hoa": "Khánh Hòa",
  "quang ninh": "Quảng Ninh", "hai duong": "Hải Dương", "long an": "Long An",
  "ba ria vung tau": "Bà Rịa - Vũng Tàu", "vung tau": "Bà Rịa - Vũng Tàu",
  "thua thien hue": "Thừa Thiên Huế", "hue": "Thừa Thiên Huế",
  "nghe an": "Nghệ An", "thanh hoa": "Thanh Hóa", "dien bien": "Điện Biên",
};

const KNOWN_PROVINCES = [
  "Hà Nội", "TP. Hồ Chí Minh", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "Bình Dương",
  "Đồng Nai", "Khánh Hòa", "Quảng Ninh", "Hải Dương", "Long An", "Bà Rịa - Vũng Tàu",
  "Thừa Thiên Huế", "Nghệ An", "Thanh Hóa", "Điện Biên", "An Giang", "Bắc Giang",
  "Bắc Ninh", "Bến Tre", "Bình Định", "Bình Phước", "Bình Thuận", "Cà Mau",
  "Cao Bằng", "Đắk Lắk", "Đắk Nông", "Đồng Tháp", "Gia Lai", "Hà Giang", "Hà Nam",
  "Hà Tĩnh", "Hậu Giang", "Hòa Bình", "Hưng Yên", "Kiên Giang", "Kon Tum",
  "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Nam Định", "Ninh Bình",
  "Ninh Thuận", "Phú Thọ", "Phú Yên", "Quảng Bình", "Quảng Nam", "Quảng Ngãi",
  "Quảng Trị", "Sóc Trăng", "Sơn La", "Tây Ninh", "Thái Bình", "Thái Nguyên",
  "Tiền Giang", "Trà Vinh", "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc", "Yên Bái",
];

/** Chuẩn hóa tỉnh/thành; null nếu không nhận dạng được (không đoán) */
export function normalizeProvince(raw?: string | null): string | null {
  if (!raw) return null;
  const s = removeDiacritics(String(raw)).toLowerCase().replace(/\s+/g, " ").trim();
  const cleaned = s
    .replace(/^tinh\s+/, "")
    .replace(/^thanh pho\s+/, "tp ")
    .replace(/^tp\.\s*/, "tp ")
    .replace(/\s*(tinh|thanh pho|city|province)$/, "")
    .trim();
  if (PROVINCE_ALIASES[cleaned]) return PROVINCE_ALIASES[cleaned];
  for (const p of KNOWN_PROVINCES) {
    const np = removeDiacritics(p).toLowerCase();
    if (np === cleaned) return p;
    if (np.replace(/^tp\.?\s*/, "") === cleaned.replace(/^tp\.?\s*/, "")) return p;
  }
  if (cleaned.length >= 3 && /^[a-z\s]+$/.test(cleaned)) {
    return cleaned.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }
  return null;
}

/** Chuẩn hóa ngành nghề thành keyword thường, bỏ dấu */
export function normalizeSector(raw?: string | null): string | null {
  if (!raw) return null;
  const s = removeDiacritics(String(raw)).toLowerCase().replace(/\s+/g, " ").trim();
  return s || null;
}

/** Chuẩn hóa email */
export function normalizeEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export type NormalizedCompany = {
  name: string;
  rawName: string | null;
  nameKey: string | null;
  taxCode: string | null;
  province: string | null;
  address: string | null;
  website: string | null;
  domain: string | null;
  sector: string | null;
  businessStatus: string;
  phones: string[];
  emails: string[];
};

/** Trường được khuyến nghị cho hồ sơ chất lượng */
export const RECOMMENDED_FIELDS = ["taxCode", "contact", "sector", "province"] as const;

export function missingRecommendedFields(n: NormalizedCompany): string[] {
  const missing: string[] = [];
  if (!n.taxCode) missing.push("taxCode");
  if (n.phones.length === 0 && n.emails.length === 0) missing.push("contact");
  if (!n.sector) missing.push("sector");
  if (!n.province) missing.push("province");
  return missing;
}
