// Dọn lead RÁC do code cũ tạo (tên = URL / câu hỏi FAQ / chứa "MST:" / nhãn liên hệ)
import { db } from "../src/lib/db";
import { isPlausibleName, cleanCompanyName } from "../src/server/extract";

const all = await db.company.findMany({ select: { id: true, name: true } });
const junkIds: string[] = [];
for (const c of all) {
  const cleaned = cleanCompanyName(c.name);
  if (!isPlausibleName(cleaned)) {
    junkIds.push(c.id);
    console.log("RÁC:", c.name.slice(0, 90));
  }
}
console.log(`\nTìm thấy ${junkIds.length} lead rác / tổng ${all.length}`);
for (const id of junkIds) {
  await db.company.delete({ where: { id } }); // cascade: contactPoint, evidence, leadScore, productFit, sourceRecord...
}
const after = await db.company.count();
console.log(`Đã xóa. DB còn ${after} lead thật.`);
process.exit(0);
