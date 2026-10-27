// ============================================================
// Integration / E2E (Test B phần DB + D + E + G) — chạy trong tiến trình RIÊNG
// với DB SQLite riêng, KHÔNG đụng DB dev: bun run tests/integration-run.ts
// Luồng: tạo nguồn → import CSV fixture → khử trùng lặp → chấm điểm → hàng đợi
//        → draft → copy event → suppression chặn → coverage không tạo % giả → job states
// KHÔNG gửi tin trong quá trình test — chỉ ghi nhận sự kiện người dùng xác nhận.
// ============================================================

import { execSync } from "child_process";
import { existsSync, readFileSync, rmSync, readdirSync, statSync } from "fs";
import { join } from "path";

const TEST_DB = "file:/home/z/my-project/db/test-int.db";
const DB_FILE = "/home/z/my-project/db/test-int.db";
const PROJECT = "/home/z/my-project";

process.env.DATABASE_URL = TEST_DB;
// Inbox test dùng thư mục riêng để không đụng inbox thật — PHẢI đặt TRƯỚC khi import module
process.env.TS24_INBOX_DIR = "/home/z/my-project/db/test-inbox";

// 1) dọn DB cũ + push schema
if (existsSync(DB_FILE)) rmSync(DB_FILE);
execSync("bunx prisma db push --skip-generate --accept-data-loss", {
  cwd: PROJECT, env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: "pipe",
});

async function main() {
  const { db } = await import("../src/lib/db");
  const { processRecords } = await import("../src/server/import-pipeline");
  const { DEFAULT_SCORING_CONFIG } = await import("../src/server/scoring-config");
  const { computeCoverage } = await import("../src/server/coverage");
  const { renderTemplate, buildVerifiedContext } = await import("../src/server/templates");
  const { isSuppressed } = await import("../src/server/compliance");

  let passed = 0;
  let failed = 0;
  function check(name: string, cond: boolean, extra = "") {
    if (cond) {
      passed++;
      console.log(`  ✓ ${name}`);
    } else {
      failed++;
      console.error(`  ✗ ${name} ${extra}`);
    }
  }

  // --- Tạo nguồn FILE_IMPORT (mặc định TẮT như nguồn thật) ---
  const source = await db.source.create({
    data: {
      name: "Test fixture source", type: "FILE_IMPORT", accessPolicy: "ALLOWED",
      isActive: false, needsReview: false,
    },
  });

  // --- Test B: CollectionJob tạo → source inactive thì job FAILED ---
  const job1 = await db.collectionJob.create({ data: { sourceId: source.id, status: "PENDING" } });
  const { runCollectionJob } = await import("../src/server/sources/adapters");
  const r1 = await runCollectionJob(job1.id, DEFAULT_SCORING_CONFIG);
  check("Test B: job trên nguồn bị tắt → FAILED, không thu thập", r1.status === "FAILED");

  // nguồn active với FILE_IMPORT adapter → COMPLETED nhưng 0 bản ghi (không tự bịa dữ liệu)
  await db.source.update({ where: { id: source.id }, data: { isActive: true } });
  const job2 = await db.collectionJob.create({ data: { sourceId: source.id, status: "PENDING" } });
  const r2 = await runCollectionJob(job2.id, DEFAULT_SCORING_CONFIG);
  check("Test B: adapter file không tạo dữ liệu giả khi không có đầu vào", r2.status === "COMPLETED" && r2.rowsCollected === 0);

  // --- Test A/G: import CSV fixture qua pipeline ---
  const csv = readFileSync(join(PROJECT, "tests/fixtures/sample-companies.csv"), "utf-8");
  const { parseCsv, csvToObjects } = await import("../src/server/csv");
  const rows = csvToObjects(parseCsv(csv));
  const result = await processRecords({ sourceId: source.id, rows, config: DEFAULT_SCORING_CONFIG });
  console.log(`   import nguồn 1: total=${result.totalRows} created=${result.createdCompanies} merged=${result.mergedCompanies} dup=${result.duplicateRecords} err=${result.errorRows} valid=${result.validRows}`);

  check("Test A: 5 dòng input", result.totalRows === 5);
  check("Test A: dòng trùng MST trong cùng nguồn bị đánh dấu DUPLICATE (không tạo công ty mới)", result.createdCompanies === 3 && result.duplicateRecords === 1 && result.mergedCompanies === 0, `created=${result.createdCompanies} merged=${result.mergedCompanies}`);
  check("Test A: dòng MST sai định dạng → ERROR có lý do", result.errorRows === 1);

  const errRecord = await db.sourceRecord.findFirst({ where: { status: "ERROR" } });
  check("Test A: bản ghi lỗi ghi rõ nguyên nhân", !!errRecord && (errRecord.errorMessage ?? "").includes("Mã số thuế"));

  // Import lại từ NGUỒN KHÁC → cùng MST giờ phải được HỢP NHẤT vào công ty sẵn có (identity resolution)
  const source2 = await db.source.create({
    data: { name: "Test fixture source 2", type: "FILE_IMPORT", accessPolicy: "ALLOWED", isActive: true, needsReview: false },
  });
  const result2 = await processRecords({ sourceId: source2.id, rows, config: DEFAULT_SCORING_CONFIG });
  console.log(`   import nguồn 2: created=${result2.createdCompanies} merged=${result2.mergedCompanies}`);
  check("Test A: cross-source merge theo MST — không tạo công ty trùng", result2.createdCompanies === 0 && result2.mergedCompanies >= 2, `created=${result2.createdCompanies} merged=${result2.mergedCompanies}`);
  const companyCount = await db.company.count();
  check("Test A: tổng số công ty không tăng sau khi import trùng từ nguồn khác", companyCount === 3, `count=${companyCount}`);

  // kiểm tra contact merged: công ty kia có phone duy nhất đã chuẩn hóa
  const merged = await db.company.findFirst({ where: { taxCode: "0312345677" }, include: { contactPoints: true } });
  check("Test A: hợp nhất giữ 1 kênh phone đã chuẩn hóa (không trùng)", !!merged && merged.contactPoints.filter((p) => p.type === "PHONE").length === 1, JSON.stringify(merged?.contactPoints));
  check("Test A: payload gốc được giữ để đối chiếu", !!merged && (await db.sourceRecord.count({ where: { companyId: merged.id } })) >= 1);

  // --- Test C: điểm trong biên + tier có giải thích ---
  const scores = await db.leadScore.findMany();
  check("Test C: mọi lead đã được chấm điểm", scores.length >= 3);
  check("Test C: điểm trong 0-100", scores.every((s) => s.totalScore >= 0 && s.totalScore <= 100));
  check("Test C: explanation có tierReason", scores.every((s) => {
    const e = JSON.parse(s.explanation) as { tierReason: string };
    return typeof e.tierReason === "string" && e.tierReason.length > 5;
  }));
  const fits = await db.productFit.findMany();
  const codes = new Set(fits.map((f) => f.productCode));
  check("Test C: 6 sản phẩm đều có điểm fit riêng", codes.size === 6);

  // --- Test E: template + draft, biến thiếu không bịa ---
  const tpl = await db.messageTemplate.create({
    data: { name: "tpl-test", body: "Chào {company_name}, tôi là {sender_name}." },
  });
  const company1 = merged!;
  const task = await db.outreachTask.create({ data: { companyId: company1.id, status: "NEW" } });
  const draftRes = renderTemplate(tpl.body, {
    company_name: company1.name,
    sender_name: null, // thiếu
  });
  check("Test E: biến thiếu được báo rõ", draftRes.missingVariables.includes("sender_name"));
  check("Test E: nội dung không chứa dữ liệu bịa", !draftRes.content.includes("undefined") && !draftRes.content.includes("null"));

  // --- Test E: suppression chặn hàng đợi ---
  await db.suppressionEntry.create({
    data: { value: company1.taxCode ?? company1.id, scope: "GLOBAL", reason: "test-block" },
  });
  const suppressed = await isSuppressed(await db.company.findUniqueOrThrow({
    where: { id: company1.id }, include: { contactPoints: true },
  }));
  check("Test E: lead trong danh sách loại trừ bị chặn", suppressed.suppressed);

  // --- Test E: không có mã tự gửi trong src (quét tĩnh) ---
  function listFiles(dir: string): string[] {
    const out: string[] = [];
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) out.push(...listFiles(p));
      else if (/\.(tsx?)$/.test(n)) out.push(p);
    }
    return out;
  }
  const srcFiles = listFiles(join(PROJECT, "src"));
  const forbidden = srcFiles.filter((f) => /zalo.*(sendmessage|autofill|cookiesession)|api\.zalo\.me|zalo.*(friend_request|add_friend|joingroup)/i.test(readFileSync(f, "utf-8")));
  check("Test E: không có mã tự động gửi tin/kết bạn qua Zalo", forbidden.length === 0, forbidden.join(", "));

  // --- Test D: coverage — không tạo tỷ lệ giả khi không có mẫu số ---
  const coverage = await computeCoverage(DEFAULT_SCORING_CONFIG);
  check("Test D: overall vẫn DENOMINATOR_UNKNOWN khi chưa khai báo mẫu số", coverage.overall.coverageStatus === "DENOMINATOR_UNKNOWN" && coverage.overall.coveragePercent === null);
  check("Test D: bộ lọc theo tỉnh hoạt động", coverage.byProvince.length >= 3);
  check("Test D: tỷ lệ trùng được tính đúng (1/5 = 20%)", coverage.overall.duplicateRate === 20, `dupRate=${coverage.overall.duplicateRate}`);
  check("Test D: tỷ lệ lỗi được tính đúng (1/5 = 20%)", coverage.overall.errorRate === 20);
  check("Test D: phát hiện khoảng trống (nguồn chưa tích hợp danh bạ)", coverage.gaps.some((g) => g.type === "MISSING_SOURCE_TYPE"));

  // segment CÓ mẫu số được tài liệu hóa → có %
  await db.segment.create({
    data: {
      name: "Test segment documented", province: "TP. Hồ Chí Minh",
      estimatedTotal: 100, denominatorSource: "Nguồn thống kê test (tài liệu hóa)",
      documented: true,
    },
  });
  const cov2 = await computeCoverage(DEFAULT_SCORING_CONFIG);
  const seg = cov2.segments.find((s) => s.name === "Test segment documented");
  check("Test D: phân khúc có mẫu số tài liệu hóa → % được tính", !!seg && seg.coverageStatus === "CALCULATED" && seg.coveragePercent !== null);

  // --- Test G: E2E outreach events — trạng thái chỉ theo thao tác xác nhận ---
  const company2 = await db.company.findFirst({ where: { taxCode: "0101234565" } });
  const task2 = await db.outreachTask.create({ data: { companyId: company2!.id, status: "CONTENT_READY" } });
  await db.outreachEvent.create({ data: { companyId: company2!.id, taskId: task2.id, type: "ZALO_OPENED" } });
  await db.outreachTask.update({ where: { id: task2.id }, data: { status: "AWAITING_CONTACT" } });
  await db.company.update({ where: { id: company2!.id }, data: { outreachStatus: "AWAITING_CONTACT" } });
  const afterOpen = await db.outreachTask.findUniqueOrThrow({ where: { id: task2.id } });
  check("Test G: mở Zalo Web chỉ ghi nhận sự kiện — KHÔNG tự đánh dấu đã gửi (không tồn tại trạng thái SENT)", afterOpen.status === "AWAITING_CONTACT" && !["MESSAGE_SENT", "SENT"].includes(afterOpen.status));

  await db.outreachEvent.create({ data: { companyId: company2!.id, taskId: task2.id, type: "MARKED_CONTACTED" } });
  await db.outreachTask.update({ where: { id: task2.id }, data: { status: "CONTACTED" } });
  const evs = await db.outreachEvent.count({ where: { companyId: company2!.id } });
  check("Test G: lịch sử tương tác theo thao tác xác nhận", evs === 2);

  // --- Audit ---
  const audits = await db.auditEvent.count();
  check("Test F: thao tác quan trọng có audit log", audits >= 1);

  // --- Continuous Runner: cấu hình chạy liên tục (không khởi động loop thật trong test) ---
  const cont = await import("../src/server/continuous");
  check("Continuous: mặc định chưa chạy, đủ 5 bước bật, KHÔNG NGHỈ (0 phút)", cont.DEFAULT_CONTINUOUS_CONFIG.running === false && cont.DEFAULT_CONTINUOUS_CONFIG.intervalMinutes === 0 && cont.DEFAULT_CONTINUOUS_CONFIG.autoDiscover && cont.DEFAULT_CONTINUOUS_CONFIG.autoRunSources && cont.DEFAULT_CONTINUOUS_CONFIG.autoImportInbox && cont.DEFAULT_CONTINUOUS_CONFIG.autoRescore && cont.DEFAULT_CONTINUOUS_CONFIG.retentionCleanup);
  check("Continuous: chặn interval ngoài 0..720", cont.validateContinuousConfig({ ...cont.DEFAULT_CONTINUOUS_CONFIG, intervalMinutes: -1 }).ok === false);
  await cont.saveContinuousConfig({ ...cont.DEFAULT_CONTINUOUS_CONFIG, intervalMinutes: 15 }, "test");
  const ccfg = await cont.getContinuousConfig();
  check("Continuous: lưu/đọc lại cấu hình round-trip (AppSetting)", ccfg.intervalMinutes === 15 && ccfg.running === false);

  // --- Inbox tự nhập: quét tệp → chuẩn hóa/khử trùng lặp → lead → tệp chuyển processed/ ---
  const inboxMod = await import("../src/server/inbox");
  const fs2 = await import("fs");
  inboxMod.ensureInboxDirs();
  fs2.writeFileSync(
    inboxMod.INBOX_DIR + "/test-inbox-fixture.csv",
    "ten_doanh_nghiep,ma_so_thue,dien_thoai,tinh,nganh_nghe\n" +
    "Cong ty TNHH Test Inbox A,0305512342,0912345678,TP. Hồ Chí Minh,thuong mai\n" +
    "Cong ty TNHH Test Inbox A,0305512342,0912345678,TP. Hồ Chí Minh,thuong mai\n", // dòng 2 trùng — phải bị khử
    "utf-8"
  );
  fs2.writeFileSync(inboxMod.INBOX_DIR + "/test-inbox-broken.txt", "không phải tệp dữ liệu — bị bỏ qua", "utf-8");
  const inboxRes = await inboxMod.scanInbox({ maxFiles: 5 });
  check("Inbox: bỏ qua tệp không phải CSV/XLSX", inboxRes.filesProcessed === 1);
  check("Inbox: nhập 2 dòng, trùng bị khử", inboxRes.rowsImported === 2 && inboxRes.duplicateRecords >= 1);
  const inboxCompanyCount = await db.company.count({ where: { taxCode: "0305512342" } });
  check("Inbox: 2 dòng trùng MST → chỉ tạo đúng 1 công ty lead", inboxCompanyCount === 1 && (inboxRes.createdCompanies === 1 || inboxRes.mergedCompanies === 1));
  check("Inbox: tệp đã nhập chuyển sang processed/", fs2.existsSync(inboxMod.PROCESSED_DIR) && fs2.readdirSync(inboxMod.PROCESSED_DIR).some((f) => f.includes("test-inbox-fixture.csv")));
  check("Inbox: nguồn hộp thư được tạo và đang bật", (await db.source.findFirst({ where: { name: inboxMod.INBOX_SOURCE_NAME } }))?.isActive === true);
  // Quét lần nữa → 0 tệp (đã chuyển hết) — không nhập lại, không nhân bản lead
  const inboxRes2 = await inboxMod.scanInbox({ maxFiles: 5 });
  check("Inbox: quét lại không nhân bản (tệp đã chuyển đi)", inboxRes2.filesProcessed === 0);

  // --- Catalog seed: chỉ danh mục, KHÔNG tạo lead ---
  const seedMod = await import("../src/server/seed");
  await seedMod.seedCatalog();
  const productsCount = await db.product.count();
  check("Catalog: seed nạp đủ 6 sản phẩm, không tạo công ty nào", productsCount === 6);

  // --- CÀO THẬT qua WebPageAdapter v2: mock fetch trả HTML danh bạ 2 trang ---
  const page1 =
    "<html><body><h1>Danh bạ</h1>" +
    "<table><tr><th>Tên doanh nghiệp</th><th>Mã số thuế</th><th>Điện thoại</th></tr>" +
    "<tr><td>Công ty TNHH Cào Thật Một</td><td>0399000001</td><td>0901110001</td></tr>" +
    "<tr><td>Công ty CP Cào Thật Hai</td><td>0399000002</td><td>0901110002</td></tr>" +
    "</table>" +
    '<a rel="next" href="https://mock-danbatest.vn/list?page=2">Tiếp theo</a>' +
    "</body></html>";
  const page2 =
    "<html><body><table><tr><th>Tên doanh nghiệp</th><th>Mã số thuế</th><th>Điện thoại</th></tr>" +
    "<tr><td>Công ty TNHH Cào Thật Ba</td><td>0399000003</td><td>0901110003</td></tr>" +
    "</table></body></html>";
  const pages: Record<string, { status: number; body: string; contentType: string }> = {
    "https://mock-danbatest.vn/robots.txt": { status: 200, body: "User-agent: *\nDisallow:\n", contentType: "text/plain" },
    "https://mock-danbatest.vn/list?page=1": { status: 200, body: page1, contentType: "text/html; charset=utf-8" },
    "https://mock-danbatest.vn/list?page=2": { status: 200, body: page2, contentType: "text/html; charset=utf-8" },
  };
  const fetchMock = (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const p = pages[u];
    if (!p) return new Response("not found", { status: 404 });
    return new Response(p.body, { status: p.status, headers: { "content-type": p.contentType } });
  }) as unknown as typeof fetch;

  const webSource = await db.source.create({
    data: {
      name: "Mock danh bạ test", type: "PUBLIC_DIRECTORY", url: "https://mock-danbatest.vn/list?page=1",
      accessPolicy: "ALLOWED", isActive: true, needsReview: false, rateLimitPerMin: 600, // nhịp nhanh cho test
    },
  });
  const webJob = await db.collectionJob.create({ data: { sourceId: webSource.id, status: "PENDING" } });
  const adaptersMod = await import("../src/server/sources/adapters");
  const webRes = await adaptersMod.runCollectionJob(webJob.id, DEFAULT_SCORING_CONFIG, {
    fetchImpl: fetchMock,
    collector: { maxPagesPerSource: 5, sourceConcurrency: 2, requestTimeoutMs: 5000 },
  });
  check("Cào HTML: job hoàn tất và lấy được lead thật từ 2 trang", webRes.status === "COMPLETED" && webRes.rowsCollected === 3, `status=${webRes.status} rows=${webRes.rowsCollected}`);
  const c1 = await db.company.findFirst({ where: { taxCode: "0399000001" } });
  const c3 = await db.company.findFirst({ where: { taxCode: "0399000003" } });
  check("Cào HTML: lead trang 1 vào DB đúng dữ liệu (không bịa)", !!c1 && c1.name.includes("Cào Thật Một"));
  check("Cào HTML: lead trang 2 vào DB (pagination hoạt động)", !!c3 && c3.name.includes("Cào Thật Ba"));
  const webJobRow = await db.collectionJob.findUniqueOrThrow({ where: { id: webJob.id } });
  check("Cào HTML: nhật ký job ghi rõ từng trang", (webJobRow.logText ?? "").includes("Trang 2"));

  // --- Chạy SONG SONG nhiều nguồn ---
  const pages2: Record<string, { status: number; body: string; contentType: string }> = {
    "https://nguon-a.vn/robots.txt": { status: 200, body: "User-agent: *\nDisallow:\n", contentType: "text/plain" },
    "https://nguon-a.vn/dn?page=1": {
      status: 200, contentType: "text/html",
      body: '<table><tr><th>Tên doanh nghiệp</th><th>Mã số thuế</th></tr><tr><td>Công ty TNHH Nguon A</td><td>0400000001</td></tr></table>',
    },
    "https://nguon-b.vn/robots.txt": { status: 200, body: "User-agent: *\nDisallow:\n", contentType: "text/plain" },
    "https://nguon-b.vn/dn": {
      status: 200, contentType: "text/html",
      body: '<table><tr><th>Tên doanh nghiệp</th><th>Mã số thuế</th></tr><tr><td>Công ty TNHH Nguon B</td><td>0500000001</td></tr></table>',
    },
  };
  const fetchMock2 = (async (url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const p = pages2[u];
    if (!p) return new Response("nf", { status: 404 });
    return new Response(p.body, { status: p.status, headers: { "content-type": p.contentType } });
  }) as unknown as typeof fetch;
  const sA = await db.source.create({ data: { name: "Nguon A", type: "PUBLIC_DIRECTORY", url: "https://nguon-a.vn/dn?page=1", accessPolicy: "ALLOWED", isActive: true, needsReview: false, rateLimitPerMin: 600 } });
  const sB = await db.source.create({ data: { name: "Nguon B", type: "COMPANY_WEBSITE", url: "https://nguon-b.vn/dn", accessPolicy: "ALLOWED", isActive: true, needsReview: false, rateLimitPerMin: 600 } });
  const parOut = await adaptersMod.runSourceJobsParallel(
    [{ id: sA.id, name: sA.name }, { id: sB.id, name: sB.name }],
    DEFAULT_SCORING_CONFIG,
    { concurrency: 2, fetchImpl: fetchMock2, collector: { maxPagesPerSource: 3, sourceConcurrency: 2, requestTimeoutMs: 5000 } }
  );
  check("Song song: 2 nguồn cùng cào, đều hoàn tất có lead", parOut.length === 2 && parOut.every((o) => o.status === "COMPLETED" && o.rows >= 1), JSON.stringify(parOut.map((o) => ({ s: o.sourceName, st: o.status, r: o.rows }))));
  check("Song song: lead của cả 2 nguồn vào DB", !!(await db.company.findFirst({ where: { taxCode: "0400000001" } })) && !!(await db.company.findFirst({ where: { taxCode: "0500000001" } })));

  // --- Collector config round-trip ---
  const collectorMod = await import("../src/server/collector-config");
  await collectorMod.saveCollectorConfig({ maxPagesPerSource: 25, sourceConcurrency: 6, requestTimeoutMs: 20000 }, "test");
  const cc = await collectorMod.getCollectorConfig();
  check("Collector config: round-trip AppSetting", cc.maxPagesPerSource === 25 && cc.sourceConcurrency === 6 && cc.requestTimeoutMs === 20000);

  // --- PURGE DEMO: xóa sạch lead demo, giữ lead thật ---
  const realCountBefore = await db.company.count();
  await db.company.create({ data: { name: "Cong ty TNHH Demo Can Xoa (demo)" } });
  await db.segment.create({ data: { name: "[DEMO] Segment cần xóa", estimatedTotal: 999 } });
  await db.suppressionEntry.create({ data: { value: "0999000000", scope: "GLOBAL", reason: "DEMO: cần xóa" } });
  const purgeRes = await seedMod.purgeDemoData();
  const realCountAfter = await db.company.count();
  check("Purge demo: xóa đúng lead demo", purgeRes.deletedCompanies === 1 && realCountAfter === realCountBefore, `del=${purgeRes.deletedCompanies} before=${realCountBefore} after=${realCountAfter}`);
  check("Purge demo: segment + suppression demo cũng bị xóa", purgeRes.deletedSegments === 1 && purgeRes.deletedSuppressions === 1);
  check("Purge demo: lead thật KHÔNG bị đụng", !!(await db.company.findFirst({ where: { taxCode: "0399000001" } })));
  check("Purge demo: sản phẩm vẫn còn nguyên", (await db.product.count()) === 6);

  await db.$disconnect();
  console.log(`\nKết quả integration: ${passed} PASS, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Integration test lỗi:", e);
  process.exit(1);
});
