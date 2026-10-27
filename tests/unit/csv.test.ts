// CSV parser/serializer + validate config
import { describe, test, expect } from "bun:test";
import { parseCsv, csvToObjects, toCsv } from "../../src/server/csv";

describe("CSV — parse", () => {
  test("tự dò delimiter ; , tab, xử lý quoted field có dấu phẩy", () => {
    const rows = parseCsv('name,tax\n"Cong ty A, Ltd",0312345677');
    expect(rows[1]).toEqual(["Cong ty A, Ltd", "0312345677"]);

    const rows2 = parseCsv("a;b\n1;2");
    expect(rows2[1]).toEqual(["1", "2"]);

    const rows3 = parseCsv("a\tb\n1\t2");
    expect(rows3[1]).toEqual(["1", "2"]);
  });

  test("xử lý BOM, xuống dòng trong ngoặc kép, dấu ngoặc kép lặp", () => {
    const rows = parseCsv("\uFEFFname,note\n\"X\",\"nói \"\"xin chào\"\"\ndòng 2\"");
    expect(rows[0][0]).toBe("name");
    expect(rows[1][1]).toBe('nói "xin chào"\ndòng 2');
  });

  test("csvToObjects normalize header bỏ dấu", () => {
    const objs = csvToObjects(parseCsv("Ten Doanh Nghiệp,Mã Số Thuế\nCong ty A,0312345677"));
    expect(objs[0]["ten_doanh_nghiep"]).toBe("Cong ty A");
    expect(objs[0]["ma_so_thue"]).toBe("0312345677");
  });
});

describe("CSV — serialize", () => {
  test("escape đúng và thêm BOM cho Excel", () => {
    const csv = toCsv(["name", "note"], [["Cong ty A", 'nói "chào", nhé']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"nói ""chào"", nhé"');
  });
});
