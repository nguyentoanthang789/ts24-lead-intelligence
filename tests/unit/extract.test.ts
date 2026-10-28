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

// ---------------- Bổ sung Task 11: hồ sơ dọc + data-mail + sitemap + lọc tên ----------------

import {
  verticalProfileFromGrid,
  verticalProfileFromDataRows,
  extractMembersWithDataMail,
  extractHeadingName,
  extractSitemapLocs,
  isPlausibleName,
  cleanCompanyName,
  verticalStrictField,
} from "../../src/server/extract";

describe("verticalStrictField (chế độ nghiêm)", () => {
  test("nhận nhãn hồ sơ chuẩn, từ chối nhãn mơ hồ", () => {
    expect(verticalStrictField("Mã số thuế")).toBe("taxCode");
    expect(verticalStrictField("Địa chỉ ĐKKD")).toBe("address");
    expect(verticalStrictField("Số điện thoại liên hệ")).toBe("phone");
    expect(verticalStrictField("Website / Tên miền")).toBe("website");
    // "ten" alias ngắn — KHÔNG dùng substring trong chế độ nghiêm
    expect(verticalStrictField("Tên giao dịch quốc tế")).toBeNull();
    expect(verticalStrictField("Tên viết tắt")).toBeNull();
    expect(verticalStrictField("Người đại diện pháp luật")).toBeNull();
  });
});

describe("verticalProfileFromGrid (bảng hồ sơ dọc)", () => {
  const PROFILE = [
    ["Mã số thuế", "0101248141"],
    ["Tên giao dịch quốc tế", "FPT CORPORATION"],
    ["Tên viết tắt", "FPT CORP"],
    ["Địa chỉ ĐKKD", "Số 10 Phạm Văn Bạch, Cầu Giấy, Hà Nội"],
    ["Người đại diện pháp luật", "TRƯƠNG GIA BÌNH"],
    ["Số điện thoại liên hệ", "02473007300"],
    ["Website / Tên miền", "fpt.com"],
  ];

  test("nhận bảng hồ sơ dọc thật → 1 record đủ trường", () => {
    const r = verticalProfileFromGrid(PROFILE);
    expect(r).not.toBeNull();
    expect(r!.taxCode).toBe("0101248141");
    expect(r!.phone).toBe("02473007300");
    expect(r!.website).toBe("fpt.com");
    expect(r!.address).toContain("Phạm Văn Bạch");
    expect(r!.name).toBeUndefined(); // name điền sau từ h1
  });

  test("từ chối bảng danh sách ngang thường (không phải hồ sơ)", () => {
    const list = [
      ["Tên doanh nghiệp", "Mã số thuế"],
      ["Công ty A", "0101"],
      ["Công ty B", "0102"],
      ["Công ty C", "0103"],
    ];
    // dòng header nhận diện ở đường gridToRows — hồ sơ dọc phải từ chối vì cell[0] các dòng là tên
    expect(verticalProfileFromGrid(list)).toBeNull();
  });

  test("từ chối bảng quá ít dòng", () => {
    expect(verticalProfileFromGrid([["Mã số thuế", "0101"]])).toBeNull();
  });
});

describe("verticalProfileFromDataRows (cặp div data-row)", () => {
  const HTML = `
  <div class="data-row"><div class="data-row-heading"><h4>Company Name</h4></div>
    <div class="data-row-value">A.R.E.N.A. Vietnam</div></div>
  <div class="data-row"><div class="data-row-heading"><h4>Telephone</h4></div>
    <div class="data-row-value">+84 2838250410</div></div>
  <div class="data-row"><div class="data-row-heading"><h4>Email</h4></div>
    <div class="data-row-value"><a href="mailto:kt@arena.vn">kt@arena.vn</a></div></div>
  <div class="data-row"><div class="data-row-heading"><h4>Website</h4></div>
    <div class="data-row-value">arena.vn</div></div>`;

  test("ghép cặp heading/value thành 1 record", () => {
    const r = verticalProfileFromDataRows(HTML);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("A.R.E.N.A. Vietnam");
    expect(r!.email).toBe("kt@arena.vn");
    expect(r!.website).toBe("arena.vn");
    expect(r!.phone).toBe("+84 2838250410");
  });
});

describe("extractMembersWithDataMail (thẻ thành viên)", () => {
  const HTML = `
  <a href="/user/A" class="mdapi-member" data-mail="ktreffel@alliance-arenavn.com">
    <div class="mdapi-member__image"><img src="x.png"></div>
    <div class="mdapi-member__title">A.R.E.N.A. Vietnam</div>
  </a>
  <a href="/user/B" class="mdapi-member" data-mail="vn@abb.com">
    <div class="mdapi-member__title">ABB ROBOTICS VIETNAM COMPANY LIMITED</div>
  </a>
  <a href="/user/C" data-mail="không-hợp-le">Khong Email</a>
  <a href="/user/D" class="mdapi-member" data-mail="dup@x.vn">
    <div class="mdapi-member__title">A.R.E.N.A. Vietnam</div>
  </a>`;

  test("lấy tên + email từ thẻ, khử trùng lặp, bỏ email rác", () => {
    const rows = extractMembersWithDataMail(HTML);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ name: "A.R.E.N.A. Vietnam", email: "ktreffel@alliance-arenavn.com" });
    expect(rows[1].name).toBe("ABB ROBOTICS VIETNAM COMPANY LIMITED");
  });
});

describe("extractHeadingName (h1/tiêu đề hồ sơ)", () => {
  test("tách tên + MST từ h1 kiểu trang chi tiết", () => {
    const r = extractHeadingName("<h1>CÔNG TY CỔ PHẦN FPT - MST 0101248141</h1>");
    expect(r).toEqual({ name: "CÔNG TY CỔ PHẦN FPT", taxCode: "0101248141" });
  });
  test("cắt phần sau dấu | của title", () => {
    const r = extractHeadingName("<title>CÔNG TY TNHH ABC - MST 0402115678 | Hồ Sơ & Đấu Thầu | Danh Bạ</title>");
    expect(r!.name).toBe("CÔNG TY TNHH ABC");
    expect(r!.taxCode).toBe("0402115678");
  });
  test("từ chối khi không phải tên doanh nghiệp", () => {
    expect(extractHeadingName("<h1>Trang chủ</h1>")).toBeNull();
  });
});

describe("extractSitemapLocs", () => {
  test("urlset → locs", () => {
    const r = extractSitemapLocs('<?xml version="1.0"?><urlset><url><loc>https://x.vn/cong-ty/0101-cong-ty-a</loc></url><url><loc>https://x.vn/cong-ty/0102-cong-ty-b</loc></url></urlset>');
    expect(r.kind).toBe("urlset");
    expect(r.locs.length).toBe(2);
  });
  test("sitemapindex → kind đúng", () => {
    const r = extractSitemapLocs('<sitemapindex><sitemap><loc>https://x.vn/s1.xml</loc></sitemap></sitemapindex>');
    expect(r.kind).toBe("sitemapindex");
  });
});

describe("isPlausibleName / cleanCompanyName (cổng chất lượng)", () => {
  test("chặn tên rác: URL, FAQ, nhãn liên hệ", () => {
    expect(isPlausibleName("https://danhbavietnam.com/cong-ty/0101-x")).toBe(false);
    expect(isPlausibleName("Số điện thoại 0977889900 là của công ty nào?")).toBe(false);
    expect(isPlausibleName("Hotline")).toBe(false);
    expect(isPlausibleName("CÔNG TY CỔ PHẦN FPT")).toBe(true);
  });
  test("cắt đuôi MST: xxx trong tên", () => {
    expect(cleanCompanyName("CÔNG TY ABC MST: 0108945612 Đang HĐ")).toBe("CÔNG TY ABC");
    expect(cleanCompanyName("CÔNG TY CỔ PHẦN FPT")).toBe("CÔNG TY CỔ PHẦN FPT");
  });
});

describe("extractCompaniesFromHtml — thứ tự ưu tiên mới", () => {
  test("trang chi tiết có bảng phụ rác → ưu tiên hồ sơ dọc, name từ h1", () => {
    const html = `
    <h1>CÔNG TY CỔ PHẦN FPT - MST 0101248141</h1>
    <table><tr><th>Mã số thuế</th><td>0101248141</td></tr>
    <tr><th>Địa chỉ ĐKKD</th><td>Số 10 Phạm Văn Bạch, Hà Nội</td></tr>
    <tr><th>Số điện thoại liên hệ</th><td>0101248141</td></tr>
    <tr><th>Website / Tên miền</th><td>fpt.com</td></tr></table>
    <table><tr><th>Mã TBMT & Gói thầu</th><td>YT-2026-001</td></tr>
    <tr><th>Bên mời thầu</th><td>Bệnh viện X</td></tr>
    <tr><th>Vai trò</th><td>Chủ đầu tư</td></tr></table>`;
    const r = extractCompaniesFromHtml(html, "https://x.vn/cong-ty/0101248141-fpt");
    expect(r.via).toBe("profile");
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].name).toBe("CÔNG TY CỔ PHẦN FPT");
    expect(r.rows[0].taxCode).toBe("0101248141");
    expect(r.rows[0].phone).toBeUndefined(); // phone trùng MST → xóa, không suy diễn
  });

  test("dòng bảng rác (URL/FAQ) bị cổng chất lượng loại", () => {
    const html = `<html><body><table>
    <tr><td><a href="/x">https://spam.vn/cong-ty/0101-abc</a></td><td>0101</td></tr>
    </table></body></html>`;
    const r = extractCompaniesFromHtml(html, "https://x.vn/");
    expect(r.rows.length).toBe(0);
  });
});
