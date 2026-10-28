// ============================================================
// Kích hoạt nguồn PHONE_ENRICHMENT (Danh Bạ VN: harvest từ khóa + hồ sơ có SĐT)
// robots.txt danhbavietnam: Allow / (chỉ cấm /admin/, /api/admin/) — đã kiểm lại tại chỗ.
// Run: bun scripts/activate-danhba-enrich.ts
// ============================================================

import { db } from "../src/lib/db";
import { checkRobots, runSourceJobsParallel } from "../src/server/sources/adapters";
import { audit } from "../src/server/compliance";
import { getScoringConfig } from "../src/server/settings";
import { getCollectorConfig, saveCollectorConfig } from "../src/server/collector-config";

const ACTOR = "operator-authorized";

const SOURCE = {
  name: "Danh Bạ Việt Nam — Làm giàu SĐT + người đại diện (harvest từ khóa)",
  type: "PHONE_ENRICHMENT",
  url: "https://danhbavietnam.com",
  rateLimitPerMin: 20,
  robotsNote:
    "robots.txt: User-agent * Allow / (chỉ cấm /admin/ và /api/admin/) — /api/search + /cong-ty/* cho phép. " +
    "Dùng /api/search JSON công khai (MST, tên, người đại diện, tỉnh, slug) + mở hồ sơ công ty để lấy SĐT công khai. " +
    "Nhịp 20 req/phút. Không né chống bot.",
};

async function main() {
  console.log("== 1) Kiểm tra robots.txt ==");
  const robots = await checkRobots(SOURCE.url);
  console.log(`  → robots=${robots.status} (${robots.note})`);
  if (robots.status !== "OK") {
    console.log("  ⛔ KHÔNG bật — robots không cho phép.");
    process.exit(1);
  }

  const existing = await db.source.findFirst({ where: { url: SOURCE.url, type: SOURCE.type } });
  const source = existing
    ? await db.source.update({
        where: { id: existing.id },
        data: { accessPolicy: "ALLOWED", isActive: true, needsReview: false, robotsStatus: robots.status, robotsNote: SOURCE.robotsNote, rateLimitPerMin: SOURCE.rateLimitPerMin },
      })
    : await db.source.create({
        data: {
          name: SOURCE.name,
          type: SOURCE.type,
          url: SOURCE.url,
          allowedScope: SOURCE.robotsNote,
          accessPolicy: "ALLOWED",
          robotsStatus: robots.status,
          robotsNote: SOURCE.robotsNote,
          dataRightsNote: `Bật theo ủy quyền operator (${ACTOR}): dữ liệu công khai trên trang hồ sơ + API tìm kiếm công khai. Chỉ phục vụ lead TS24.`,
          retentionDays: 180,
          rateLimitPerMin: SOURCE.rateLimitPerMin,
          isActive: true,
          needsReview: false,
        },
      });
  console.log(`  ✅ nguồn ${existing ? "cập nhật" : "tạo mới"} + BẬT (id=${source.id})`);
  await audit({ actor: ACTOR, action: "source.activated", entityType: "Source", entityId: SOURCE.url, detail: { name: SOURCE.name, robots: robots.status, type: SOURCE.type } });

  const collector = await getCollectorConfig();
  const next = { ...collector, maxPagesPerSource: Math.max(collector.maxPagesPerSource, 80), sourceConcurrency: 3 };
  await saveCollectorConfig(next, ACTOR);

  console.log("\n== 2) CHẠY CÀO THẬT (harvest từ khóa → hồ sơ SĐT) ==");
  const config = await getScoringConfig();
  const t0 = Date.now();
  const outcomes = await runSourceJobsParallel([{ id: source.id, name: source.name }], config, { concurrency: 1, collector: next });
  for (const o of outcomes) console.log(`  [${o.status}] ${o.sourceName}: ${o.rows} rows — ${o.message}`);
  console.log(`  Thời gian: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("\n== 3) Kiểm chứng DB ==");
  const total = await db.company.count();
  const withMst = await db.company.count({ where: { taxCode: { not: null } } });
  const withContact = await db.company.count({ where: { contactName: { not: null } } });
  const withPhone = await db.company.count({ where: { contactPoints: { some: { type: "PHONE" } } } });
  const all3 = await db.company.count({ where: { taxCode: { not: null }, contactName: { not: null }, contactPoints: { some: { type: "PHONE" } } } });
  console.log(`  Tổng lead: ${total} | MST: ${withMst} | Người liên lạc: ${withContact} | SĐT: ${withPhone} | Đủ cả 3: ${all3}`);
  const sample = await db.company.findMany({
    take: 6,
    where: { contactPoints: { some: { type: "PHONE" } }, contactName: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { name: true, taxCode: true, contactName: true, contactPoints: { where: { type: "PHONE" }, select: { normalized: true } } },
  });
  for (const c of sample) console.log(`  → ${c.name} | MST ${c.taxCode ?? "-"} | ${c.contactName ?? "-"} | ${c.contactPoints[0]?.normalized ?? "-"}`);
  process.exit(0);
}

await main();
