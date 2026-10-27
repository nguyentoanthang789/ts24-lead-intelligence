import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaPragmaApplied?: boolean
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // log query chỉ khi bật DEBUG_PRISMA — tránh chi phí log khi chạy thông lượng cao
    log: process.env.DEBUG_PRISMA === "1" ? ['query'] : [],
  })

// SQLite: bật WAL + synchronous=NORMAL — tăng mạnh tốc độ ghi (đặc biệt khi
// bot cào/import hàng nghìn lead mỗi vòng). Best-effort, lỗi không chặn app.
if (!globalForPrisma.prismaPragmaApplied) {
  globalForPrisma.prismaPragmaApplied = true
  db.$executeRawUnsafe('PRAGMA journal_mode=WAL;').catch(() => {})
  db.$executeRawUnsafe('PRAGMA synchronous=NORMAL;').catch(() => {})
  db.$executeRawUnsafe('PRAGMA busy_timeout=5000;').catch(() => {})
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
