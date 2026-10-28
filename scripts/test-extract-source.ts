// Test extractor THẬT của app (src/server/extract.ts) trên HTML thật đã tải.
// Run: DATABASE_URL=file:/home/z/my-project/db/custom.db bun scripts/test-extract-source.ts <file.html> <baseUrl>

import { readFileSync } from "node:fs";
import { extractCompaniesFromHtml, extractCompaniesFromJson } from "../src/server/extract";

const [file, baseUrl] = process.argv.slice(2);
if (!file || !baseUrl) {
  console.error("Usage: bun scripts/test-extract-source.ts <file.html> <baseUrl>");
  process.exit(1);
}
const html = readFileSync(file, "utf8");
const res = extractCompaniesFromHtml(html, baseUrl);
console.log(`via=${res.via} | rows=${res.rows.length} | nextLinks=${res.nextLinks.length}`);
console.log("nextLinks:", res.nextLinks.slice(0, 5));
for (const r of res.rows.slice(0, 10)) {
  console.log("→", JSON.stringify(r));
}
if (res.rows.length === 0) {
  // thử JSON extractor (RSC payload là text lớn chứa JSON)
  const jrows = extractCompaniesFromJson(html);
  console.log(`[fallback JSON extractor] rows=${jrows.length}`);
  for (const r of jrows.slice(0, 5)) console.log("→", JSON.stringify(r).slice(0, 220));
}
