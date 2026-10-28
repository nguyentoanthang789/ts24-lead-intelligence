import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const main = async () => {
  const total = await db.company.count();
  const withMst = await db.company.count({ where: { taxCode: { not: null } } });
  const cps = await db.contactPoint.groupBy({ by: ["type"], _count: true });
  const cpsWithVal = await db.contactPoint.findMany({ where: { type: "PHONE" }, take: 5, select: { value: true } });
  const sources = await db.source.findMany({ select: { name: true, isActive: true, type: true, url: true } });
  console.log(JSON.stringify({ total, withMst, contactPointsByType: cps, samplePhones: cpsWithVal, sources }, null, 2));
};
main().finally(() => db.$disconnect());
