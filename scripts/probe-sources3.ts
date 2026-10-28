// Probe vòng 3: nhắm nguồn CÓ MST + SĐT + NGƯỜI LIÊN LẠC công khai (danh bạ chi tiết, trang vàng, hiệp hội, sàn B2B).
// Run: bun scripts/probe-sources3.ts
import { mkdirSync, writeFileSync } from "node:fs";

const UA = "TS24LeadIntelligence/1.0 (compliance-aware collector; respects robots.txt)";
const OUT_DIR = "/home/z/my-project/scripts/probe-out";
mkdirSync(OUT_DIR, { recursive: true });

const CANDIDATES: { label: string; url: string }[] = [
  // Danh bạ doanh nghiệp chi tiết (thường có MST + SĐT + người đại diện)
  { label: "hosocongty.vn", url: "https://hosocongty.vn" },
  { label: "congty.vn", url: "https://congty.vn" },
  { label: "timcongty.vn", url: "https://timcongty.vn" },
  { label: "thongtindoanhnghiep.co (retry path)", url: "https://thongtindoanhnghiep.co/tra-cuu-ma-so-thue" },
  { label: "companyinfo.vn", url: "https://companyinfo.vn" },
  { label: "infodoanhnghiep.co", url: "https://infodoanhnghiep.co" },
  { label: "tracuumst.com", url: "https://tracuumst.com" },
  { label: "mst.vn", url: "https://mst.vn" },
  { label: "doanhnghieponline", url: "https://doanhnghieponline.gov.vn" },
  // Sàn B2B / thương mại — thẻ công ty thường có SĐT + người liên hệ
  { label: "vietnamexport.com", url: "https://www.vietnamexport.com" },
  { label: "vntrades", url: "https://vntrades.com" },
  { label: "sanvangonline", url: "https://sanvangonline.com" },
  { label: "24hcongty", url: "https://24hcongty.com" },
  { label: "hangnhatvn", url: "https://hangnhat.com.vn" },
  // Hiệp hội / thương vụ — danh mục thành viên có SĐT
  { label: "auschamvn", url: "https://auschamvn.org.au" },
  { label: "ccichn.org.vn", url: "https://www.ccichn.org.vn" },
  { label: "vcci.org.vn", url: "https://vcci.org.vn" },
  { label: "ccihcmc.org.vn", url: "https://ccihcmc.org.vn" },
  { label: "singchamvn", url: "https://www.singchamvn.org" },
  { label: "canadianchamvietnam", url: "https://canchamvietnam.ca" },
  // Danh bạ địa phương
  { label: "danhbavietnam company page", url: "https://danhbavietnam.com/cong-ty/tnhh-minh-phat-3700995588" },
  { label: "danhbavietnam sitemap index", url: "https://danhbavietnam.com/api/sitemaps/sitemap-index.xml" },
  { label: "danhbavietnam search api (paginate)", url: "https://danhbavietnam.com/api/search?q=cong+ty+tnhh&page=2" },
  // Open data VN
  { label: "opencorporates VN", url: "https://api.opencorporates.com/v0.4/companies/search?q=vietnam" },
  { label: "gitlab datasets", url: "https://gitlab.com/api/v4/projects?search=doanh+nghiep" },
  { label: "datahub.io", url: "https://datahub.io/dataset?search=vietnam" },
];

async function probe(c: { label: string; url: string }) {
  let httpStatus: number | null = null;
  let bytes = 0;
  let error = "";
  try {
    const res = await fetch(c.url, {
      headers: { "user-agent": UA, accept: "application/json,text/html;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    httpStatus = res.status;
    if (res.ok) {
      const body = await res.text();
      bytes = body.length;
      const host = new URL(res.url || c.url).host.replace(/[^a-z0-9.-]/gi, "_");
      writeFileSync(`${OUT_DIR}/r3-${host}.html`, body.slice(0, 500_000));
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}` : String(e);
  }
  return { ...c, httpStatus, bytes, error };
}

const queue = [...CANDIDATES];
const results: Awaited<ReturnType<typeof probe>>[] = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const c = queue.shift()!;
      const r = await probe(c);
      results.push(r);
      console.log(`${r.httpStatus === 200 ? "✅" : r.httpStatus === 403 || r.httpStatus === 429 ? "⛔" : "⚠️"} ${r.label} → ${r.httpStatus ?? "-"} | ${Math.round(r.bytes / 1024)}KB | ${r.error}`);
    }
  }),
);
writeFileSync(`${OUT_DIR}/probe3-summary.json`, JSON.stringify(results, null, 2));
console.log("\nSaved:", results.filter((r) => r.httpStatus === 200).length, "OK of", results.length);
