// CSV parse/serialize (pure) — hỗ trợ delimiter , ; \t, quoted fields, BOM

export function parseCsv(input: string, delimiter?: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const lines: string[][] = [];
  let curField = "";
  let curRow: string[] = [];
  let inQuotes = false;
  let d = delimiter;
  if (!d) {
    // tự dò delimiter từ dòng đầu (ngoài ngoặc kép)
    const firstLineEnd = text.indexOf("\n");
    const head = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
    const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
    let q = false;
    for (const ch of head) {
      if (ch === '"') q = !q;
      if (!q && ch in counts) counts[ch]++;
    }
    d = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    if (counts[d] === 0) d = ",";
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          curField += '"';
          i++;
        } else inQuotes = false;
      } else curField += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === d) {
      curRow.push(curField);
      curField = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      curRow.push(curField);
      curField = "";
      if (curRow.length > 1 || curRow[0] !== "") lines.push(curRow);
      curRow = [];
    } else {
      curField += ch;
    }
  }
  curRow.push(curField);
  if (curRow.length > 1 || curRow[0] !== "") lines.push(curRow);
  return lines;
}

/** Chuyển mảng hàng CSV thành mảng object theo header (normalize header: trim, bỏ dấu, lowercase) */
export function csvToObjects(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const norm = (s: string) =>
    s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
  const header = rows[0].map(norm);
  return rows.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = r[i] ?? "";
    });
    return obj;
  });
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(esc).join(",")];
  for (const r of rows) lines.push(r.map(esc).join(","));
  // BOM để Excel mở đúng UTF-8
  return "\uFEFF" + lines.join("\r\n");
}
