// ============================================================
// Kích hoạt nguồn ĐÃ KIỂM TRA robots.txt + CHẠY CÀO THẬT.
// Ủy quyền: user ("Bạn tự chạy nguồn vào đi => xong cào thêm lead").
// - Mỗi nguồn: check robots TRƯỚC — chỉ bật nếu OK / NO_ROBOTS(404).
// - Không né chống bot: 403/429/RESTRICTED → KHÔNG bật.
// Run: DATABASE_URL=... bun scripts/activate-and-crawl.ts
// ============================================================

import { db } from "../src/lib/db";
import { checkRobots, runSourceJobsParallel } from "../src/server/sources/adapters";
import { audit } from "../src/server/compliance";
import { getScoringConfig } from "../src/server/settings";
import { getCollectorConfig, saveCollectorConfig } from "../src/server/collector-config";

const ACTOR = "operator-authorized";

type ToActivate = {
  name: string;
  type: string;
  url: string;
  rateLimitPerMin: number;
  robotsNote: string;
};

const SOURCES: ToActivate[] = [
  {
    name: "Danh Bạ Việt Nam — Sitemap hồ sơ công ty",
    type: "PUBLIC_DIRECTORY",
    url: "https://danhbavietnam.com/api/sitemaps/sitemap-companies-latest.xml",
    rateLimitPerMin: 20,
    robotsNote: "robots.txt: User-agent * Allow / (chỉ cấm /admin/ và /api/admin/); sitemap được nguồn công bố công khai cho bot. Đã probe HTTP 200 từ sandbox.",
  },
  {
    name: "Danh Bạ Việt Nam — API tìm kiếm công ty",
    type: "OFFICIAL_API",
    url: "https://danhbavietnam.com/api/search?q=cong+ty",
    rateLimitPerMin: 20,
    robotsNote: "robots.txt cho phép /api/search (chỉ cấm /admin/, /api/admin/). API JSON công khai: MST, tên, tỉnh, trạng thái.",
  },
  {
    name: "EuroCham Việt Nam — Danh mục thành viên",
    type: "PUBLIC_DIRECTORY",
    url: "https://www.eurochamvn.org/members",
    rateLimitPerMin: 30,
    robotsNote: "Không có robots.txt (404) — mặc định cho phép theo chính sách nguồn; dữ liệu thành viên hiển thị công khai.",
  },
];

async function activate() {
  console.log("== 1) Kiểm tra robots.txt từng nguồn ==");
  const enabledIds: { id: string; name: string }[] = [];
  for (const s of SOURCES) {
    const robots = await checkRobots(s.url);
    const canEnable = robots.status === "OK"; // 404 robots cũng được app map về OK
    console.log(`  ${s.name} → robots=${robots.status} (${robots.note})`);
    if (!canEnable) {
      console.log(`    ⛔ KHÔNG bật — robots không cho phép.`);
      continue;
    }
    const existing = await db.source.findFirst({ where: { url: s.url } });
    if (existing) {
      const updated = await db.source.update({
        where: { id: existing.id },
        data: {
          accessPolicy: "ALLOWED",
          isActive: true,
          needsReview: false,
          robotsStatus: robots.status,
          robotsNote: `${s.robotsNote} | Kiểm tra lại: ${robots.note}`,
          rateLimitPerMin: s.rateLimitPerMin,
        },
      });
      enabledIds.push({ id: updated.id, name: updated.name });
      console.log(`    ✅ đã cập nhật + BẬT (id=${updated.id})`);
    } else {
      const created = await db.source.create({
        data: {
          name: s.name,
          type: s.type,
          url: s.url,
          allowedScope: s.robotsNote,
          accessPolicy: "ALLOWED",
          robotsStatus: robots.status,
          robotsNote: s.robotsNote,
          dataRightsNote: `Bật theo ủy quyền của operator (${ACTOR}): nguồn công khai, robots cho phép, dữ liệu hiển thị công khai. Chỉ phục vụ lead TS24, không phân phối lại.`,
          retentionDays: 180,
          rateLimitPerMin: s.rateLimitPerMin,
          isActive: true,
          needsReview: false,
        },
      });
      enabledIds.push({ id: created.id, name: created.name });
      console.log(`    ✅ đã tạo + BẬT (id=${created.id})`);
    }
    await audit({
      actor: ACTOR,
      action: "source.activated",
      entityType: "Source",
      entityId: s.url,
      detail: { name: s.name, robots: robots.status, reason: "ủy quyền operator: tự chạy nguồn + cào lead" },
    });
  }

  console.log("\n== 2) Cấu hình tốc độ thu thập (maxPages=25, concurrency=3) ==");
  const collector = await getCollectorConfig();
  const next = { ...collector, maxPagesPerSource: 25, sourceConcurrency: 3 };
  await saveCollectorConfig(next, ACTOR);
  console.log(`  maxPagesPerSource=${next.maxPagesPerSource}, sourceConcurrency=${next.sourceConcurrency}, timeout=${next.requestTimeoutMs}ms`);

  console.log("\n== 3) CHẠY CÀO THẬT ==");
  const config = await getScoringConfig();
  const t0 = Date.now();
  const outcomes = await runSourceJobsParallel(enabledIds, config, { concurrency: next.sourceConcurrency, collector: next });
  for (const o of outcomes) {
    console.log(`  [${o.status}] ${o.sourceName}: ${o.rows} rows — ${o.message}`);
  }
  const total = outcomes.reduce((s, o) => s + o.rows, 0);
  const secs = (Date.now() - t0) / 1000;
  console.log(`\nTổng ${total} bản ghi trong ${secs.toFixed(1)}s → ${(total / Math.max(secs, 0.001)).toFixed(1)} rows/s (qua mạng, gồm rate-limit)`);

  console.log("\n== 4) Trạng thái DB ==");
  const companies = await db.company.count();
  const valid = await db.sourceRecord.count({ where: { status: "VALID" } });
  console.log(`  Company: ${companies} | SourceRecord VALID: ${valid}`);
  const sample = await db.company.findMany({ take: 5, orderBy: { createdAt: "desc" }, select: { name: true, taxCode: true, province: true, businessStatus: true } });
  for (const c of sample) console.log(`  → ${c.name} | MST ${c.taxCode ?? "-"} | ${c.province ?? "-"} | ${c.businessStatus}`);
  process.exit(0);
}

await activate();
