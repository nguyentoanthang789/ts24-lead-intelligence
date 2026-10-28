// ============================================================
// Probe NHIỀU nguồn ứng viên từ sandbox để tìm nguồn cào được THẬT.
// - UA bot trung thực, không ngụy trang, không né chống bot.
// - 403/429/captcha = nguồn từ chối → bỏ qua, KHÔNG cố vượt.
// - Sniff dấu hiệu doanh nghiệp VN trong nội dung + lưu mẫu HTML phân tích.
// Run: bun scripts/probe-sources.ts
// ============================================================

import { mkdirSync, writeFileSync } from "node:fs";

const UA = "TS24LeadIntelligence/1.0 (compliance-aware collector; respects robots.txt)";
const OUT_DIR = "/home/z/my-project/scripts/probe-out";
mkdirSync(OUT_DIR, { recursive: true });

type Candidate = { label: string; url: string; kind: string };

const CANDIDATES: Candidate[] = [
  // ---- Chính thống / dữ liệu mở ----
  { label: "Cổng ĐKKD quốc gia", url: "https://dangkykinhdoanh.gov.vn", kind: "official" },
  { label: "GSO Tổng cục Thống kê", url: "https://www.gso.gov.vn", kind: "official" },
  { label: "data.gov.vn (CKAN)", url: "https://data.gov.vn", kind: "open-data" },
  { label: "mst.gov.vn", url: "https://mst.gov.vn", kind: "official" },
  { label: "Tổng cục Thuế", url: "https://www.gdt.gov.vn", kind: "official" },
  { label: "muasamcong (e-GP)", url: "https://muasamcong.mpi.gov.vn", kind: "official" },
  { label: "sme.gov.vn", url: "https://sme.gov.vn", kind: "official" },
  // ---- Danh bạ VN ----
  { label: "masothue.com", url: "https://masothue.com", kind: "directory" },
  { label: "thongtindoanhnghiep.co", url: "https://thongtindoanhnghiep.co", kind: "directory" },
  { label: "trangvangvietnam.com", url: "https://www.trangvangvietnam.com", kind: "directory" },
  { label: "yellowpages.vn", url: "https://yellowpages.vn", kind: "directory" },
  { label: "trangvang.vn", url: "https://trangvang.vn", kind: "directory" },
  { label: "companyvn.net", url: "https://www.companyvn.net", kind: "directory" },
  { label: "infodoanhnghiep.com", url: "https://infodoanhnghiep.com", kind: "directory" },
  { label: "hoikinhdoanh.vn", url: "https://hoikinhdoanh.vn", kind: "directory" },
  { label: "dnbc.vn", url: "https://dnbc.vn", kind: "directory" },
  { label: "topdoanhnghiep.vn", url: "https://topdoanhnghiep.vn", kind: "directory" },
  { label: "doanhnghiepgannay.com", url: "https://doanhnghiepgannay.com", kind: "directory" },
  { label: "vat.com.vn", url: "https://vat.com.vn", kind: "directory" },
  { label: "danhbavietnam.com", url: "https://danhbavietnam.com", kind: "directory" },
  { label: "xahoithongtin? doanhtru", url: "https://doanhtru.vn", kind: "directory" },
  // ---- Hội/hiệp hội/phi lợi nhuận ----
  { label: "VCCI", url: "https://vcci.org.vn", kind: "association" },
  { label: "VCCI HCM", url: "https://www.vcci-hcm.org.vn", kind: "association" },
  { label: "Hanoia", url: "https://hanoia.org.vn", kind: "association" },
  { label: "vinasme", url: "https://vinasme.gov.vn", kind: "association" },
  // ---- Thương mại / B2B quốc tế có DN Việt Nam ----
  { label: "vietnamexport.com", url: "https://www.vietnamexport.com", kind: "trade" },
  { label: "ec21 (VN)", url: "https://vietnam.ec21.com", kind: "trade" },
  { label: "tradekey VN", url: "https://www.tradekey.com/country/Vietnam/", kind: "trade" },
  { label: "go4worldbusiness VN", url: "https://www.go4worldbusiness.com/suppliers/vietnam.html", kind: "trade" },
  // ---- Chứng khoán (DN niêm yết — thông tin công khai) ----
  { label: "stockbiz.vn", url: "https://stockbiz.vn", kind: "market" },
  { label: "vietstock", url: "https://finance.vietstock.vn", kind: "market" },
  { label: "simplize.vn", url: "https://simplize.vn", kind: "market" },
  // ---- Dữ liệu mở quốc tế ----
  { label: "Wikidata Query", url: "https://query.wikidata.org", kind: "open-data" },
  { label: "OpenCorporates VN", url: "https://opencorporates.com/companies/vn", kind: "open-data" },
  { label: "OpenDev Vietnam", url: "https://vietnam.opendevelopmentmekong.net", kind: "open-data" },
  { label: "Wikipedia VN companies", url: "https://vi.wikipedia.org/wiki/Thể_loại:Doanh_nghiệp_Việt_Nam", kind: "open-data" },
];

type RobotsInfo = { status: string; note: string };

function parseRobots(text: string): { disallowAll: boolean; starDisallows: string[]; crawlDelay: number | null } {
  const lines = text.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  let inStar = false;
  let disallowAll = false;
  const starDisallows: string[] = [];
  let crawlDelay: number | null = null;
  for (const line of lines) {
    if (line.startsWith("user-agent:")) inStar = line.includes("*");
    else if (inStar && line.startsWith("disallow:")) {
      const p = line.slice(9).trim();
      if (p === "/") disallowAll = true;
      else if (p) starDisallows.push(p);
    } else if (inStar && line.startsWith("crawl-delay:")) {
      const v = parseFloat(line.slice(12).trim());
      if (!isNaN(v)) crawlDelay = v;
    }
  }
  return { disallowAll, starDisallows, crawlDelay };
}

async function checkRobots(url: string): Promise<RobotsInfo> {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(6000),
    });
    if (res.status === 404) return { status: "NO_ROBOTS(404)", note: "không có robots.txt" };
    if (!res.ok) return { status: `HTTP_${res.status}`, note: "robots.txt không đọc được" };
    const r = parseRobots(await res.text());
    if (r.disallowAll) return { status: "RESTRICTED", note: "Disallow: / — cấm toàn bộ" };
    return { status: "OK", note: `ok (${r.starDisallows.length} disallow, delay=${r.crawlDelay ?? "-"})` };
  } catch (e) {
    return { status: "CHECK_FAILED", note: e instanceof Error ? e.message.slice(0, 60) : "lỗi" };
  }
}

const COMPANY_MARKERS = [
  /công ty\s+(tnhh|cổ phần|cp)/i,
  /\btnhh\b/i,
  /cổ phần/i,
  /doanh nghiệp/i,
  /mã số thuế/i,
  /\bMST\b/,
];

async function probe(c: Candidate) {
  const robots = await checkRobots(c.url);
  let httpStatus: number | null = null;
  let bytes = 0;
  let markerHits = 0;
  let error = "";
  try {
    const res = await fetch(c.url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    });
    httpStatus = res.status;
    if (res.ok) {
      const body = await res.text();
      bytes = body.length;
      markerHits = COMPANY_MARKERS.filter((m) => m.test(body)).length;
      // lưu mẫu để phân tích parser
      const host = new URL(res.url || c.url).host.replace(/[^a-z0-9.-]/gi, "_");
      writeFileSync(`${OUT_DIR}/${host}.html`, body.slice(0, 300_000));
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name}: ${e.message.slice(0, 80)}` : String(e);
  }
  return { ...c, robots, httpStatus, bytes, markerHits, error };
}

async function main() {
  console.log(`Probing ${CANDIDATES.length} candidates from sandbox (UA: ${UA})...\n`);
  const results: Awaited<ReturnType<typeof probe>>[] = [];
  // chạy 6 luồng song song cho nhanh
  const queue = [...CANDIDATES];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const c = queue.shift()!;
      const r = await probe(c);
      results.push(r);
      const ok = r.httpStatus === 200 && r.markerHits >= 2;
      const tag = ok ? "✅" : r.httpStatus === 403 || r.httpStatus === 429 ? "⛔" : r.httpStatus ? "⚠️" : "🌐";
      console.log(`${tag} [${r.kind}] ${r.label} → HTTP ${r.httpStatus ?? "-"} | ${Math.round(r.bytes / 1024)}KB | markers=${r.markerHits} | robots=${r.robots.status} | ${r.error}`);
    }
  });
  await Promise.all(workers);
  console.log("\n=== RANKED (HTTP 200 + markers>=2 + robots OK) ===");
  const winners = results
    .filter((r) => r.httpStatus === 200 && r.markerHits >= 2 && r.robots.status !== "RESTRICTED")
    .sort((a, b) => b.markerHits - a.markerHits);
  for (const w of winners) console.log(`${w.label} | ${w.url} | markers=${w.markerHits} | robots=${w.robots.status} | ${Math.round(w.bytes / 1024)}KB`);
  if (!winners.length) console.log("(không có ứng viên nào đạt)");
  writeFileSync(`${OUT_DIR}/probe-result.json`, JSON.stringify(results, null, 2));
}

await main();
