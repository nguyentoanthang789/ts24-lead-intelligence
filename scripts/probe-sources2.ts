// Probe vòng 2: nguồn dữ liệu mở + hiệp hội + cổng chính thống.
// Run: bun scripts/probe-sources2.ts
import { mkdirSync, writeFileSync } from "node:fs";

const UA = "TS24LeadIntelligence/1.0 (compliance-aware collector; respects robots.txt)";
const OUT_DIR = "/home/z/my-project/scripts/probe-out";
mkdirSync(OUT_DIR, { recursive: true });

const CANDIDATES: { label: string; url: string }[] = [
  { label: "Wikidata SPARQL", url: "https://query.wikidata.org/sparql?query=SELECT%20%3Fitem%20%3Flabel%20WHERE%20%7B%20%3Fitem%20wdt%3AP17%20wd%3AQ881%20.%20%3Fitem%20rdfs%3Alabel%20%3Flabel%20.%20FILTER(LANG(%3Flabel)%3D%22vi%22)%7D%20LIMIT%205&format=json" },
  { label: "GitHub API search", url: "https://api.github.com/search/repositories?q=doanh+nghiep+dataset&per_page=5" },
  { label: "topcv.vn", url: "https://topcv.vn" },
  { label: "itviec.com", url: "https://itviec.com" },
  { label: "topdev.vn", url: "https://topdev.vn" },
  { label: "hangviet.vn", url: "https://hangviet.vn" },
  { label: "vatgia.com", url: "https://vatgia.com" },
  { label: "hnx.vn", url: "https://www.hnx.vn" },
  { label: "evbn.org", url: "https://evbn.org" },
  { label: "eurochamvn.org", url: "https://eurochamvn.org" },
  { label: "amchamvietnam.com", url: "https://www.amchamvietnam.com" },
  { label: "vinasa.org.vn", url: "https://vinasa.org.vn" },
  { label: "vla.vn", url: "https://vla.vn" },
  { label: "doanhnghiepvn.vn", url: "https://doanhnghiepvn.vn" },
  { label: "fdi.gov.vn", url: "https://fdi.gov.vn" },
  { label: "Wikipedia category (retry)", url: "https://vi.wikipedia.org/wiki/Th%E1%BB%83_lo%E1%BA%A1i:Doanh_nghi%E1%BB%87p_Vi%E1%BB%87t_Nam" },
  { label: "dangkykinhdoanh search", url: "https://dangkykinhdoanh.gov.vn/vi/trang-chu" },
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
      writeFileSync(`${OUT_DIR}/r2-${host}.html`, body.slice(0, 500_000));
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
  })
);
writeFileSync(`${OUT_DIR}/probe2-result.json`, JSON.stringify(results, null, 2));
