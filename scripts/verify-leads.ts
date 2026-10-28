// Kiểm định chất lượng lead thật trong DB
import { db } from "../src/lib/db";

const total = await db.company.count();
const withMST = await db.company.count({ where: { taxCode: { not: null } } });
const withEmail = await db.contactPoint.count({ where: { type: "EMAIL" } });
const withPhone = await db.contactPoint.count({ where: { type: "PHONE" } });
const withWebsite = await db.company.count({ where: { website: { not: null } } });
const withAddress = await db.company.count({ where: { address: { not: null } } });
console.log("Tổng lead:", total);
console.log("Có MST:", withMST, "| Contact email:", withEmail, "| Contact SĐT:", withPhone, "| Có website:", withWebsite, "| Có địa chỉ:", withAddress);

console.log("\n--- Mẫu lead từ Danh Bạ Việt Nam (có MST) ---");
const mst = await db.company.findMany({
  where: { taxCode: { not: null } },
  take: 6,
  orderBy: { createdAt: "desc" },
  include: { contactPoints: { take: 3 } },
});
for (const c of mst) {
  const contacts = c.contactPoints.map((p) => `${p.type}:${p.normalized}`).join(", ");
  console.log("→", c.name, "| MST", c.taxCode, "|", (c.address ?? "").slice(0, 55), "|", contacts.slice(0, 70), "|", c.website ?? "-");
}

console.log("\n--- Mẫu lead EuroCham (tên + email) ---");
const echam = await db.company.findMany({
  where: { name: { contains: "VIETNAM" } },
  take: 5,
  orderBy: { createdAt: "asc" },
  include: { contactPoints: { take: 2 } },
});
for (const c of echam) {
  const contacts = c.contactPoints.map((p) => `${p.type}:${p.normalized}`).join(", ");
  console.log("→", c.name.slice(0, 55), "|", contacts.slice(0, 60));
}

console.log("\n--- Điểm & tier ---");
const tiers = await db.leadScore.groupBy({ by: ["tier"], _count: { tier: true } });
for (const t of tiers) console.log("tier", t.tier, ":", t._count.tier);
const scores = await db.leadScore.findMany({ take: 3, orderBy: { totalScore: "desc" }, include: { company: { select: { name: true } } } });
for (const s of scores) console.log("top:", s.company.name.slice(0, 50), "→", s.totalScore, s.tier);

console.log("\n--- Nguồn ---");
const srcs = await db.sourceRecord.groupBy({ by: ["sourceId", "status"], _count: true });
for (const s of srcs) console.log("source", s.sourceId.slice(-6), s.status, ":", s._count);
process.exit(0);
