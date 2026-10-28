// ============================================================
// Dọn dữ liệu rác do vòng cào CŨ để lại (trước khi có cổng chất lượng):
// 1) ContactPoint PHONE có số trùng MST của chính công ty (kể cả tiền tố 84) → XÓA
//    (MST bị bộ trích xuất cũ nhầm thành SĐT — không phải SĐT thật)
// 2) Company.name dính artifact dán nhiều ô ("; ANKHANG MED; Thành phố...;")
//    hoặc đuôi "- MST xxx" → CẮT về phần tên thật (dữ liệu nguồn vẫn nguyên trong SourceRecord)
// Không bịa dữ liệu — chỉ xóa/cắt phần nhiễu có mẫu hình rõ ràng.
// Run: bun scripts/cleanup-mst-phone.ts
// ============================================================

import { db } from "../src/lib/db";

async function main() {
  console.log("== 1) Xóa SĐT-trùng-MST ==");
  const companies = await db.company.findMany({
    where: { contactPoints: { some: { type: "PHONE" } } },
    select: { id: true, taxCode: true, contactPoints: { where: { type: "PHONE" }, select: { id: true, normalized: true } } },
  });
  let removed = 0;
  for (const c of companies) {
    if (!c.taxCode) continue;
    const mst = c.taxCode.replace(/\D/g, "");
    const mstNo0 = mst.replace(/^0/, ""); // dạng 84-prefix bỏ số 0 đầu (E.164)
    const bad = c.contactPoints.filter((p) => {
      const d = p.normalized.replace(/\D/g, "");
      return d === mst || d === `84${mstNo0}` || d === mstNo0;
    });
    for (const p of bad) {
      await db.contactPoint.delete({ where: { id: p.id } });
      removed++;
      console.log(`  xóa ${p.normalized} (trùng MST ${c.taxCode}) của #${c.id.slice(-6)}`);
    }
  }
  console.log(`  Đã xóa ${removed} SĐT giả (trùng MST)`);

  console.log("\n== 2) Cắt tên dính artifact ==");
  const all = await db.company.findMany({ select: { id: true, name: true } });
  let fixed = 0;
  for (const c of all) {
    let name = c.name;
    if (name.includes(";")) name = name.split(";")[0].trim(); // dán nhiều ô: tên thật = ô đầu
    name = name.replace(/\s*(?:[-–—]\s*)?MST\s*:?\s*\d{10}(?:-\d{3})?\s*[\s\S]*$/i, "").replace(/[\s\-–—]+$/, "").trim();
    if (name && name !== c.name) {
      await db.company.update({ where: { id: c.id }, data: { name } });
      fixed++;
      console.log(`  sửa: "${c.name.slice(0, 60)}" → "${name.slice(0, 60)}"`);
    }
  }
  console.log(`  Đã sửa ${fixed} tên`);

  console.log("\n== 3) Trạng thái DB ==");
  const total = await db.company.count();
  const withMst = await db.company.count({ where: { taxCode: { not: null } } });
  const withContact = await db.company.count({ where: { contactName: { not: null } } });
  const withPhone = await db.company.count({ where: { contactPoints: { some: { type: "PHONE" } } } });
  const all3 = await db.company.count({ where: { taxCode: { not: null }, contactName: { not: null }, contactPoints: { some: { type: "PHONE" } } } });
  console.log(`  Tổng: ${total} | MST: ${withMst} | Người liên lạc: ${withContact} | SĐT: ${withPhone} | Đủ cả 3: ${all3}`);
  process.exit(0);
}

await main();
