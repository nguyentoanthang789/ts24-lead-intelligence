// One-time purge của DB dev: hiện tại toàn bộ lead trong DB đều là dữ liệu
// giả (demo "(demo)" + lead từ tệp mẫu template) → xóa sạch để hệ thống
// chỉ còn lead thật. Script dùng 1 lần rồi để lại làm tài liệu.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const before = await db.company.count();
  console.log(`[purge] Trước khi dọn: ${before} lead`);
  if (before > 0) {
    // xóa toàn bộ — DB dev chỉ chứa dữ liệu mẫu ở thời điểm này
    await db.outreachEvent.deleteMany({});
    await db.outreachTask.deleteMany({});
    await db.leadScore.deleteMany({});
    await db.productFit.deleteMany({});
    await db.evidence.deleteMany({});
    await db.contactPoint.deleteMany({});
    await db.sourceRecord.deleteMany({});
    await db.company.deleteMany({});
  }
  const seg = await db.segment.deleteMany({ where: { name: { contains: "[DEMO]" } } });
  const sup = await db.suppressionEntry.deleteMany({ where: { reason: { contains: "DEMO" } } });
  // nguồn demo example.com (không phải nguồn thật)
  const srcDemo = await db.source.deleteMany({ where: { url: { contains: "example.com" } } });
  const after = await db.company.count();
  console.log(`[purge] Đã xóa ${before - after} lead giả, ${seg.count} segment demo, ${sup.count} suppression demo, ${srcDemo.count} nguồn example.com`);
  console.log(`[purge] Sau khi dọn: ${after} lead — DB sạch, chỉ nhận lead thật từ giờ`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[purge] Lỗi:", err);
    process.exit(1);
  });
