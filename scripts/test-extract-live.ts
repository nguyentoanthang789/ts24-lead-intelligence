// Kiểm tra nhanh extractor với trang hồ sơ THẬT đã tải (tracuumst + danhbavietnam)
import { readFileSync } from "node:fs";
import { extractCompaniesFromHtml } from "../src/server/extract";

const files = [
  "/tmp/mst-profile.html",
  "/tmp/mst-profile2.html",
  "/tmp/dbv-profile.html",
];

for (const f of files) {
  const html = readFileSync(f, "utf8");
  const r = extractCompaniesFromHtml(html, "https://x");
  console.log(`\n=== ${f} → via=${r.via}, ${r.rows.length} rows ===`);
  for (const row of r.rows.slice(0, 10)) {
    console.log(JSON.stringify(row));
  }
}
