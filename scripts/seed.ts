// CLI seed: bun run scripts/seed.ts
import { seedDemoData } from "../src/server/seed";
import { db } from "../src/lib/db";

async function main() {
  console.log("[seed] Nạp dữ liệu demo tổng hợp...");
  const result = await seedDemoData();
  console.log("[seed] Kết quả:", {
    totalRows: result.totalRows,
    validRows: result.validRows,
    createdCompanies: result.createdCompanies,
    mergedCompanies: result.mergedCompanies,
    duplicateRecords: result.duplicateRecords,
    errorRows: result.errorRows,
    needsReview: result.needsReview,
  });
  const companies = await db.company.count();
  console.log(`[seed] Tổng số công ty trong DB: ${companies}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] Lỗi:", err);
    process.exit(1);
  });
