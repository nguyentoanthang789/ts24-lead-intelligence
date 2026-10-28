// ============================================================
// Kích hoạt nguồn TracuuMST (sitemap 45k hồ sơ mã số thuế) + CHẠY CÀO THẬT.
// Ủy quyền: operator — nguồn công khai, robots.txt chỉ cấm /tim-kiem, /search,
// /ajax/ (trang hồ sơ công ty ĐƯỢC PHÉP); sitemap do nguồn công bố cho bot.
// Ranh giới: 403/429 → dừng an toàn; rate limit 60 req/phút (1s/request).
// Run: bun scripts/activate-tracuumst.ts
// ============================================================

import { db } from "../src/lib/db";
import { checkRobots, runSourceJobsParallel } from "../src/server/sources/adapters";
import { audit } from "../src/server/compliance";
import { getScoringConfig } from "../src/server/settings";
import { getCollectorConfig, saveCollectorConfig } from "../src/server/collector-config";

const ACTOR = "operator-authorized";

const SOURCE = {
  name: "TracuuMST — Sitemap hồ sơ mã số thuế",
  type: "PUBLIC_DIRECTORY",
  url: "https://tracuumst.com/sitemap-priority-new.xml",
  rateLimitPerMin: 60,
  robotsNote:
    "robots.txt: User-agent * — chỉ Disallow /tim-kiem, /search, /ajax/; trang hồ sơ mã số thuế CHO PHÉP. " +
    "Sitemap công bố công khai 45.000 URL hồ sơ (mỗi hồ sơ: MST, tên, người đại diện, địa chỉ, tình trạng). " +
    "Probe HTTP 200 từ sandbox. Không có Crawl-delay — bot tự giữ nhịp 60 req/phút.",
};

async function main() {
  console.log("== 1) Kiểm tra robots.txt ==");
  const robots = await checkRobots(SOURCE.url);
  console.log(`  ${SOURCE.name} → robots=${robots.status} (${robots.note})`);
  if (robots.status !== "OK") {
    console.log("  ⛔ KHÔNG bật — robots không cho phép. DỪNG, không né chống bot.");
    process.exit(1);
  }

  const existing = await db.source.findFirst({ where: { url: SOURCE.url } });
  const source = existing
    ? await db.source.update({
        where: { id: existing.id },
        data: {
          accessPolicy: "ALLOWED",
          isActive: true,
          needsReview: false,
          robotsStatus: robots.status,
          robotsNote: `${SOURCE.robotsNote} | Kiểm tra lại: ${robots.note}`,
          rateLimitPerMin: SOURCE.rateLimitPerMin,
        },
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
          dataRightsNote: `Bật theo ủy quyền operator (${ACTOR}): nguồn công khai, robots cho phép trang hồ sơ, dữ liệu hiển thị công khai. Chỉ phục vụ lead TS24, không phân phối lại.`,
          retentionDays: 180,
          rateLimitPerMin: SOURCE.rateLimitPerMin,
          isActive: true,
          needsReview: false,
        },
      });
  console.log(`  ✅ nguồn ${existing ? "cập nhật" : "tạo mới"} + BẬT (id=${source.id})`);
  await audit({
    actor: ACTOR,
    action: "source.activated",
    entityType: "Source",
    entityId: SOURCE.url,
    detail: { name: SOURCE.name, robots: robots.status, reason: "ủy quyền operator: chạy nguồn tracuumst để có MST + người liên lạc" },
  });

  console.log("\n== 2) Cấu hình tốc độ: maxPages=400, concurrency=3, giữ nhịp 60 req/phút ==");
  const collector = await getCollectorConfig();
  const next = { ...collector, maxPagesPerSource: 400, sourceConcurrency: 3 };
  await saveCollectorConfig(next, ACTOR);

  console.log("\n== 3) CHẠY CÀO THẬT (sitemap mode + resume checkpoint) ==");
  const config = await getScoringConfig();
  const t0 = Date.now();
  const outcomes = await runSourceJobsParallel([{ id: source.id, name: source.name }], config, {
    concurrency: next.sourceConcurrency,
    collector: next,
  });
  for (const o of outcomes) console.log(`  [${o.status}] ${o.sourceName}: ${o.rows} rows — ${o.message}`);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nThời gian: ${secs}s`);

  console.log("\n== 4) Kiểm chứng DB: lead có MST / người liên lạc / SĐT ==");
  const total = await db.company.count();
  const withMst = await db.company.count({ where: { taxCode: { not: null } } });
  const withContact = await db.company.count({ where: { contactName: { not: null } } });
  const withPhone = await db.company.count({ where: { contactPoints: { some: { type: "PHONE" } } } });
  const all3 = await db.company.count({ where: { taxCode: { not: null }, contactName: { not: null }, contactPoints: { some: { type: "PHONE" } } } });
  console.log(`  Tổng lead: ${total}`);
  console.log(`  Có MST: ${withMst} | Có người liên lạc: ${withContact} | Có SĐT: ${withPhone} | Đủ cả 3: ${all3}`);
  const sample = await db.company.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: { name: true, taxCode: true, contactName: true, province: true, businessStatus: true, contactPoints: { where: { type: "PHONE" }, select: { normalized: true } } },
  });
  for (const c of sample) console.log(`  → ${c.name} | MST ${c.taxCode ?? "-"} | ${c.contactName ?? "-"} | ${c.contactPoints[0]?.normalized ?? "-"} | ${c.businessStatus}`);
  process.exit(0);
}

await main();
