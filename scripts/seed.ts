// CLI seed catalog: bun run scripts/seed.ts — CHỈ nạp danh mục cấu hình,
// KHÔNG tạo lead giả. Xóa lead demo: bun run scripts/purge-demo.ts
import { seedCatalog } from "../src/server/seed";
import { db } from "../src/lib/db";

async function main() {
  console.log("[seed] Nạp danh mục cấu hình (sản phẩm + mẫu tin nhắn + nguồn)...");
  await seedCatalog();
  const companies = await db.company.count();
  console.log(`[seed] Hoàn tất. Số lead hiện có trong DB: ${companies} (chỉ lead thật — không tạo lead giả)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] Lỗi:", err);
    process.exit(1);
  });
