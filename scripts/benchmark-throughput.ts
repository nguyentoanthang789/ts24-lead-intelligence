// ============================================================
// Benchmark thông lượng — trả lời: "1 giây bot cào tối đa bao nhiêu lead?"
//
// 2 mặt của con số:
// 1) XỬ LÝ (CPU+SQLite): chuẩn hóa + khử trùng lặp + chấm điểm + lưu DB
//    → benchmark trực tiếp trên máy này.
// 2) MẠNG (cào nguồn thật): bị chặn bởi rate limit từng nguồn CỤ THỂ
//    (robots.txt + tốc độ nguồn cho phép) — công thức:
//      lead/giây ≈ (số nguồn song song) × (rateLimitPhút/60) × (lead/trang)
//    Hệ thống KHÔNG né chống bot nên đây là trần hợp pháp.
// Chạy: bun run scripts/benchmark-throughput.ts
// ============================================================

import { existsSync, rmSync } from "fs";
import { execSync } from "child_process";

const BENCH_DB = "file:/home/z/my-project/db/bench.db";
const DB_FILE = "/home/z/my-project/db/bench.db";
process.env.DATABASE_URL = BENCH_DB;

async function main() {
  const { normalizeRow } = await import("../src/server/import-pipeline");
  const { buildSourceDedupKey } = await import("../src/server/dedup");
  const { scoreLead } = await import("../src/server/scoring");
  const { DEFAULT_SCORING_CONFIG } = await import("../src/server/scoring-config");

  // ---------- 1) PURE: normalize + dedupKey + score (không DB) ----------
  const N = 50_000;
  const rows: Record<string, string>[] = [];
  for (let i = 0; i < N; i++) {
    rows.push({
      ten_doanh_nghiep: `Cong ty TNHH Kinh Doanh So ${i}`,
      ma_so_thue: `03${String(1000000 + i).padStart(8, "0")}`,
      dien_thoai: `090${String(1000000 + i).slice(0, 7)}`,
      email: `contact${i}@congty${i}.vn`,
      website: `https://congty${i}.vn`,
      tinh: i % 2 === 0 ? "TP. Hồ Chí Minh" : "Hà Nội",
      nganh_nghe: "Thương mại dịch vụ",
      nam_thanh_lap: String(2000 + (i % 25)),
      trang_thai: "Đang hoạt động",
    });
  }
  const mcBase = {
    businessStatus: "ACTIVE", establishedYear: 2015, sizeSignal: null,
    evidenceKinds: [{ kind: "SECTOR", confidence: "MEDIUM" }, { kind: "PUBLIC_CONTACT", confidence: "MEDIUM" }],
    hasPublicContact: true, missingFields: [] as string[],
  };
  const t0 = performance.now();
  let scoredCount = 0;
  for (const row of rows) {
    const { normalized } = normalizeRow(row);
    buildSourceDedupKey(normalized);
    scoreLead({ ...mcBase, name: normalized.name, sector: normalized.sector, province: normalized.province }, [], DEFAULT_SCORING_CONFIG, { ruleVersion: "bench" });
    scoredCount++;
  }
  const pureMs = performance.now() - t0;
  const purePerSec = Math.round((scoredCount / pureMs) * 1000);
  console.log(`\n=== 1) XỬ LÝ THUẦN (không DB) ===`);
  console.log(`${scoredCount.toLocaleString("vi-VN")} lead đã được xử lý trong ${(pureMs / 1000).toFixed(2)}s → ${purePerSec.toLocaleString("vi-VN")} lead/giây`);

  // ---------- 2) DB: processRecords đầy đủ (ghi SQLite) ----------
  if (existsSync(DB_FILE)) rmSync(DB_FILE);
  execSync("bunx prisma db push --skip-generate --accept-data-loss", {
    cwd: "/home/z/my-project", env: { ...process.env }, stdio: "pipe",
  });
  const { db } = await import("../src/lib/db");
  const { processRecords } = await import("../src/server/import-pipeline");
  const source = await db.source.create({ data: { name: "Bench source", type: "FILE_IMPORT", accessPolicy: "ALLOWED", isActive: true, needsReview: false } });
  const BATCH = 2_000;
  const benchRows = rows.slice(0, BATCH);
  const t1 = performance.now();
  const r = await processRecords({ sourceId: source.id, rows: benchRows, config: DEFAULT_SCORING_CONFIG });
  const dbMs = performance.now() - t1;
  const dbPerSec = Math.round((r.totalRows / dbMs) * 1000);
  console.log(`\n=== 2) PIPELINE ĐẦY ĐỦ + LƯU SQLite ===`);
  console.log(`${r.totalRows.toLocaleString("vi-VN")} dòng (tạo ${r.createdCompanies} lead) trong ${(dbMs / 1000).toFixed(2)}s → ${dbPerSec.toLocaleString("vi-VN")} lead/giây`);

  // dọn DB bench
  await db.$disconnect();
  rmSync(DB_FILE, { force: true });
  const jn = rmSync("/home/z/my-project/db/bench.db-journal", { force: true });
  void jn;

  console.log(`\n=== 3) MẠNG: cào nguồn thật (trần hợp pháp) ===`);
  console.log(`Công thức: lead/giây ≈ nguồn_đang_chạy × (rateLimitPhút / 60) × lead_mỗi_trang`);
  const scenarios: { sources: number; rate: number; perPage: number; concurrency: number }[] = [
    { sources: 4, rate: 10, perPage: 20, concurrency: 4 },
    { sources: 4, rate: 30, perPage: 20, concurrency: 4 },
    { sources: 8, rate: 30, perPage: 30, concurrency: 8 },
    { sources: 8, rate: 60, perPage: 30, concurrency: 8 },
  ];
  for (const s of scenarios) {
    const lps = ((s.rate / 60) * s.sources * s.perPage).toFixed(0);
    console.log(`- ${s.sources} nguồn × ${s.rate} req/phút × ~${s.perPage} lead/trang (song song ${s.concurrency}) → ~${lps} lead/giây (trần, nếu nguồn cho phép)`);
  }
  console.log(`\nGhi chú: số lead/trang phụ thuộc nguồn thật; hệ thống tôn trọng robots.txt + rate limit — KHÔNG né chống bot.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[bench] Lỗi:", err);
    process.exit(1);
  });
