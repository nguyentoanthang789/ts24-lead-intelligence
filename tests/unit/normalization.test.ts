// Test A — Chuẩn hóa dữ liệu (domain, phone, MST, tên, tỉnh, ngành)
import { describe, test, expect } from "bun:test";
import {
  normalizeTaxCode, isValidTaxCode, normalizePhoneVN, normalizeDomain,
  buildNameKey, normalizeProvince, normalizeSector, normalizeEmail,
  removeDiacritics, missingRecommendedFields, NormalizedCompany,
} from "../../src/server/normalization";

describe("Normalization — Mã số thuế", () => {
  test("chuẩn hóa 10 số và MST chi nhánh 13 số", () => {
    expect(normalizeTaxCode("0312345677")).toBe("0312345677");
    expect(normalizeTaxCode("0312345.677-001")).toBe("0312345677001");
    expect(normalizeTaxCode("  0 3 1 2 3 4 5 6 7 7 ")).toBe("0312345677");
  });
  test("trả null cho định dạng sai (không đoán)", () => {
    expect(normalizeTaxCode("12345")).toBeNull();
    expect(normalizeTaxCode("")).toBeNull();
    expect(normalizeTaxCode(null)).toBeNull();
  });
  test("checksum MST chính thức", () => {
    expect(isValidTaxCode("0312345677")).toBe(true);
    expect(isValidTaxCode("0312345678")).toBe(false);
  });
});

describe("Normalization — Số điện thoại VN", () => {
  test("chuẩn hóa các dạng đầu số về 84xxxxxxxxx", () => {
    expect(normalizePhoneVN("0901234567")).toBe("84901234567");
    expect(normalizePhoneVN("+84 90 123 4567")).toBe("84901234567");
    expect(normalizePhoneVN("091-234-5678")).toBe("84912345678");
    expect(normalizePhoneVN("0084901234567")).toBe("84901234567");
  });
  test("trả null cho số sai/không phải VN", () => {
    expect(normalizePhoneVN("123456")).toBeNull();
    expect(normalizePhoneVN("1234567890")).toBeNull();
    expect(normalizePhoneVN("0101234567")).toBeNull();
    expect(normalizePhoneVN("")).toBeNull();
  });
});

describe("Normalization — Domain", () => {
  test("bỏ protocol, www, path, port", () => {
    expect(normalizeDomain("https://www.MinhPhat.vn/san-pham")).toBe("minhphat.vn");
    expect(normalizeDomain("http://NHAXANH.vn:8080")).toBe("nhaxanh.vn");
    expect(normalizeDomain("vungchat-demo.vn")).toBe("vungchat-demo.vn");
  });
  test("chặn IP trần và giá trị rác", () => {
    expect(normalizeDomain("192.168.1.1")).toBeNull();
    expect(normalizeDomain("not a domain")).toBeNull();
    expect(normalizeDomain("")).toBeNull();
  });
});

describe("Normalization — nameKey", () => {
  test("bỏ tiền tố pháp lý và dấu", () => {
    expect(buildNameKey("Công ty TNHH Minh Phát")).toBe("minh phat");
    expect(buildNameKey("CÔNG TY CỔ PHẦN BÁN LẺ NHÀ XANH")).toBe("ban le nha xanh");
    expect(buildNameKey("CTCP Chuoi Thuc Pham Vung Chat")).toBe("chuoi thuc pham vung chat");
  });
});

describe("Normalization — Tỉnh/thành", () => {
  test("nhận dạng alias phổ biến", () => {
    expect(normalizeProvince("TP. HCM")).toBe("TP. Hồ Chí Minh");
    expect(normalizeProvince("Hà Nội")).toBe("Hà Nội");
    expect(normalizeProvince("tinh binh duong")).toBe("Bình Dương");
    expect(normalizeProvince("TP.HCM")).toBe("TP. Hồ Chí Minh");
  });
  test("không đoán tỉnh lạ", () => {
    expect(normalizeProvince("Nơi không xác định xyz 123")).toBeNull();
  });
});

describe("Normalization — ngành & email", () => {
  test("sector bỏ dấu lowercase", () => {
    expect(normalizeSector("Thương Mại Phân Phối")).toBe("thuong mai phan phoi");
  });
  test("email hợp lệ/không hợp lệ", () => {
    expect(normalizeEmail(" Info@MinhPhat.VN ")).toBe("info@minhphat.vn");
    expect(normalizeEmail("khong-phai-email")).toBeNull();
  });
  test("removeDiacritics giữ đ/d đúng", () => {
    expect(removeDiacritics("Đà Nẵng")).toBe("Da Nang");
  });
});

describe("missingRecommendedFields — thiếu dữ liệu phải được chỉ rõ", () => {
  test("đủ trường → rỗng; thiếu → liệt kê", () => {
    const full: NormalizedCompany = {
      name: "X", rawName: "X", nameKey: "x", taxCode: "0312345677",
      province: "Hà Nội", address: null, website: null, domain: null,
      sector: "thuong mai", businessStatus: "ACTIVE", phones: ["84901234567"], emails: [],
    };
    expect(missingRecommendedFields(full)).toEqual([]);
    const thin: NormalizedCompany = { ...full, taxCode: null, phones: [], emails: [], sector: null, province: null };
    expect(missingRecommendedFields(thin)).toEqual(["taxCode", "contact", "sector", "province"]);
  });
});
