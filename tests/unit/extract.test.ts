// Test — Generic Extractor: trích doanh nghiệp thật từ HTML/JSON nguồn công khai
// (pure functions — không mạng, không DB)
import { describe, test, expect } from "bun:test";
import {
  decodeEntities,
  deaccent,
  canonicalFieldFromHeader,
  extractTables,
  gridToRows,
  extractCompaniesFromText,
  extractCompaniesFromJson,
  extractCompaniesFromHtml,
  extractNextLinks,
} from "../../src/server/extract";

describe("decodeEntities / deaccent", () => {
  test("giải mã entity HTML cơ bản", () => {
    expect(decodeEntities("Công ty &amp; đối tác")).toBe("Công ty & đối tác");
    expect(decodeEntities("A&nbsp;B &#272;C")).toBe("A B ĐC");
  });
  test("bỏ dấu tiếng Việt để so khớp", () => {
    expect(deaccent("Cổ Phần Điện Máy")).toBe("co phan dien may");
  });
});

describe("canonicalFieldFromHeader", () => {
  test("nhận ra header tiếng Việt không dấu/không chuẩn", () => {
    expect(canonicalFieldFromHeader("Tên doanh nghiệp")).toBe("name");
    expect(canonicalFieldFromHeader("Mã số thuế")).toBe("taxCode");
    expect(canonicalFieldFromHeader("Điện thoại")).toBe("phone");
    expect(canonicalFieldFromHeader("Tỉnh thành")).toBe("province");
    expect(canonicalFieldFromHeader("Ngành nghề")).toBe("sector");
  });
  test("trả null với header lạ", () => {
    expect(canonicalFieldFromHeader("Ghi chú thêm")).toBe(null);
  });
});

const TABLE_HTML = `
<html><body>
<table>
  <tr><th>Tên doanh nghiệp</th><th>Mã số thuế</th><th>Điện thoại</th><th>Email</th><th>Tỉnh</th></tr>
  <tr><td>Công ty TNHH An Phát 1</td><td>0312345671</td><td>0901112223</td><td>info@anphat1.vn</td><td>TP. Hồ Chí Minh</td></tr>
  <tr><td>Công ty CP Thương Mai Xanh</td><td>0109876543</td><td>0912223334</td><td>lienhe@tmx.vn</td><td>Hà Nội</td></tr>
</table>
</body></html>`;

describe("extractTables + gridToRows", () => {
  test("tách bảng thành lưới cell", () => {
    const tables = extractTables(TABLE_HTML);
    expect(tables.length).toBe(1);
    expect(tables[0].length).toBe(3); // header + 2 dòng
    expect(tables[0][1][0]).toBe("Công ty TNHH An Phát 1");
  });
  test("map header alias → từng dòng là 1 ImportRow chuẩn", () => {
    const tables = extractTables(TABLE_HTML);
    const rows = gridToRows(tables[0]);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Công ty TNHH An Phát 1");
    expect(rows[0].taxCode).toBe("0312345671");
    expect(rows[0].phone).toBe("0901112223");
    expect(rows[0].email).toBe("info@anphat1.vn");
    expect(rows[0].province).toBe("TP. Hồ Chí Minh");
  });
  test("bảng không header → heuristic vẫn nhận ra DN + liên hệ", () => {
    const grid = [
      ["Công ty TNHH Sản Xuất Hưng Thịnh", "0356778899", "0918123456"],
      ["Sản xuất cơ khí chế tạo", "Quận 7, TP.HCM"],
    ];
    const rows = gridToRows(grid);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toContain("Hưng Thịnh");
    expect(rows[0].phone).toBe("0918123456");
  });
});

describe("extractCompaniesFromText (trang dạng chữ)", () => {
  test("nhận khối có tên DN + MST theo ngữ cảnh", () => {
    const text = [
      "Công ty TNHH Đầu Tư Bình Minh",
      "MST: 0311223344 - Điện thoại: 0903456789",
      "Email: info@binhminh.vn",
      "",
      "Liên hệ hợp tác: 0908111222",
    ].join("\n");
    const rows = extractCompaniesFromText(text);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("Công ty TNHH Đầu Tư Bình Minh");
    expect(rows[0].taxCode).toBe("0311223344");
    expect(rows[0].email).toContain("binhminh.vn");
  });
  test("BỎ khối không đủ dữ liệu liên hệ — không bịa", () => {
    const rows = extractCompaniesFromText("Công ty TNHH Chỉ Có Tên Thôi");
    expect(rows.length).toBe(0);
  });
  test("số 10 chữ số không có ngữ cảnh MST thì KHÔNG nhận làm MST (tránh nhầm số điện thoại)", () => {
    const text = "Công ty TNHH ABC\nĐiện thoại: 0311223344\nEmail: a@b.vn";
    const rows = extractCompaniesFromText(text);
    expect(rows.length).toBe(1);
    expect(rows[0].taxCode).toBeUndefined();
    expect(rows[0].phone).toContain("0311223344");
  });
});

describe("extractCompaniesFromJson (OFFICIAL_API)", () => {
  test("map key JSON qua alias → rows", () => {
    const json = JSON.stringify({
      data: [
        { company_name: "Công ty TNHH Data One", ma_so_thue: "0300011112", sdt: "0905556667", tinh: "TP. Hồ Chí Minh" },
        { company_name: "Công ty CP Data Two", ma_so_thue: "0300011113", sdt: "0905556668" },
      ],
    });
    const rows = extractCompaniesFromJson(json);
    expect(rows.length).toBe(2);
    expect(rows[0].name).toBe("Công ty TNHH Data One");
    expect(rows[0].taxCode).toBe("0300011112");
    expect(rows[1].phone).toBe("0905556668");
  });
  test("JSON hỏng → rỗng, không ném lỗi", () => {
    expect(extractCompaniesFromJson("không phải json{{")).toEqual([]);
  });
});

describe("extractNextLinks (pagination)", () => {
  const base = "https://danbavd.example.vn/danh-ba?page=1";
  const html = `
    <a href="/danh-ba?page=1">Trang 1</a>
    <a href="/danh-ba?page=2">2</a>
    <a href="/danh-ba?page=5">Trang cuối</a>
    <a href="https://site-khac.com/list?page=3">ngoài host</a>
    <a href="/danh-ba?page=2" rel="next">Tiếp theo</a>`;
  test("chỉ lấy link cùng host, ưu tiên trang liền sau", () => {
    const links = extractNextLinks(html, base);
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.includes("danbavd.example.vn"))).toBe(true);
    expect(links[0]).toContain("page=2"); // rel=next + page liền sau đứng đầu
  });
});

describe("extractCompaniesFromHtml (entry point)", () => {
  test("bảng → rows + nextLinks; đa trang mô phỏng", () => {
    const r = extractCompaniesFromHtml(TABLE_HTML, "https://danbavd.example.vn/danh-ba");
    expect(r.via).toBe("table");
    expect(r.rows.length).toBe(2);
  });
  test("trang không có gì → via none, 0 rows (không bịa)", () => {
    const r = extractCompaniesFromHtml("<html><body><p>Trang trống</p></body></html>", "https://x.vn/");
    expect(r.rows.length).toBe(0);
    expect(r.via).toBe("none");
  });
});
