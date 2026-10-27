// ============================================================
// Module 3 — Collector Engine: adapter độc lập, giao diện thống nhất
// Nguyên tắc: không vượt CAPTCHA/đăng nhập/chống bot; dừng an toàn khi nguồn từ chối;
// không tạo dữ liệu giả khi không lấy được; rate limit + retry có giới hạn + checkpoint
// ============================================================

import { db } from "@/lib/db";
import { ImportRow } from "../import-pipeline";
import { processRecords } from "../import-pipeline";
import { ScoringConfig } from "../scoring-config";
import { audit } from "../compliance";

export type CollectorContext = {
  jobId: string;
  sourceId: string;
  sourceUrl: string | null;
  rateLimitPerMin: number;
  /** hàm fetch có thể inject để test không chạy mạng thật */
  fetchImpl?: typeof fetch;
  /** dừng an toàn — được poll giữa các bước */
  shouldStop?: () => Promise<boolean>;
};

export type CollectorResult = {
  status: "COMPLETED" | "FAILED" | "CANCELLED";
  rowsCollected: number;
  message: string;
};

export interface CollectorAdapter {
  readonly name: string;
  /** Adapter chỉ chạy khi nguồn được phép */
  canRun(accessPolicy: string): boolean;
  /** Thu thập → trả về mảng row thô (không persist ở đây) */
  collect(ctx: CollectorContext): Promise<ImportRow[]>;
}

/**sleep helper */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry có giới hạn với backoff — KHÔNG retry vô hạn */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number; onRetry?: (attempt: number, err: unknown) => void }
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      opts.onRetry?.(attempt + 1, err);
      if (attempt < maxRetries) await sleep((opts.baseDelayMs ?? 500) * (attempt + 1));
    }
  }
  throw lastErr;
}

/** Kiểm tra robots.txt: trả về trạng thái và ghi chú; lỗi mạng → CHECK_FAILED (không giả định cho phép) */
export async function checkRobots(url: string, fetchImpl: typeof fetch = fetch): Promise<{ status: "OK" | "RESTRICTED" | "UNKNOWN" | "CHECK_FAILED"; note: string }> {
  try {
    const u = new URL(url);
    const robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
    const res = await withRetry(() => fetchImpl(robotsUrl, { signal: AbortSignal.timeout(8000) }), { maxRetries: 1 });
    if (res.status === 404) return { status: "OK", note: "Không có robots.txt (404) — mặc định cho phép, vẫn cần kiểm tra điều khoản" };
    if (!res.ok) return { status: "UNKNOWN", note: `robots.txt trả mã ${res.status} — cần xem xét thủ công` };
    const text = await res.text();
    // phân tích tối giản: User-agent: * → Disallow: / (cấm toàn bộ)
    const lines = text.split(/\r?\n/).map((l) => l.trim().toLowerCase());
    let inStar = false;
    let disallowAll = false;
    for (const line of lines) {
      if (line.startsWith("user-agent:")) {
        inStar = line.includes("*");
      } else if (inStar && line.startsWith("disallow:")) {
        const path = line.slice("disallow:".length).trim();
        // path rỗng (không cấm gì) hoặc "/" (cấm gốc) — "/" là cấm toàn bộ
        if (path === "" || path === "/") {
          if (path === "/") disallowAll = true;
        }
      }
    }
    if (disallowAll) return { status: "RESTRICTED", note: "robots.txt cấm thu thập toàn bộ (Disallow: /) — KHÔNG được bật thu thập" };
    return { status: "OK", note: "robots.txt không cấm toàn bộ; vẫn phải tuân thủ các Disallow cụ thể khi thu thập" };
  } catch (err) {
    return { status: "CHECK_FAILED", note: `Không kiểm tra được robots.txt: ${err instanceof Error ? err.message : "lỗi mạng"}` };
  }
}

// ---------------- Adapter 1: FILE (CSV/XLSX do người dùng cung cấp) ----------------

export class FileImportAdapter implements CollectorAdapter {
  readonly name = "file-import";
  canRun(accessPolicy: string): boolean {
    return accessPolicy !== "DISALLOWED";
  }
  async collect(ctx: CollectorContext): Promise<ImportRow[]> {
    // File import nhận dữ liệu trực tiếp từ request upload — không thu thập mạng.
    // Job file-import được tạo sau khi upload đã xử lý xong; ở đây trả rỗng để giữ giao diện thống nhất.
    return [];
  }
}

// ---------------- Adapter 2: WEBPAGE (nguồn công khai cho phép, robots-aware) ----------------

export class WebPageAdapter implements CollectorAdapter {
  readonly name = "webpage";
  canRun(accessPolicy: string): boolean {
    return accessPolicy === "ALLOWED";
  }
  async collect(ctx: CollectorContext): Promise<ImportRow[]> {
    if (!ctx.sourceUrl) throw new Error("Nguồn webpage cần URL");
    // 1) Kiểm robots trước
    const robots = await checkRobots(ctx.sourceUrl, ctx.fetchImpl ?? fetch);
    if (robots.status === "RESTRICTED") {
      throw new Error(`Nguồn từ chối thu thập theo robots.txt — dừng an toàn: ${robots.note}`);
    }
    if (robots.status === "CHECK_FAILED") {
      throw new Error(`Không xác minh được điều kiện truy cập — dừng an toàn: ${robots.note}`);
    }
    // 2) Rate limit: delay giữa các request theo rateLimitPerMin
    const delayMs = Math.max(0, Math.ceil(60000 / Math.max(1, ctx.rateLimitPerMin)));
    await sleep(delayMs);
    // 3) Fetch trang chính (chỉ 1 trang/1 lần chạy trong MVP — không crawl đệ quy)
    const res = await withRetry(
      () => (ctx.fetchImpl ?? fetch)(ctx.sourceUrl!, { signal: AbortSignal.timeout(15000) }),
      { maxRetries: 2, baseDelayMs: 800, onRetry: (n, e) => logJob(ctx.jobId, `Retry lần ${n}: ${e instanceof Error ? e.message : e}`) }
    );
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      throw new Error(`Nguồn từ chối truy cập (HTTP ${res.status}) — dừng an toàn, không né cơ chế chống bot`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} khi truy cập nguồn`);
    const html = await res.text();
    // 4) Ghi checkpoint
    await db.collectionCheckpoint.create({
      data: { jobId: ctx.jobId, cursor: JSON.stringify({ url: ctx.sourceUrl, done: true }), note: "Đã tải trang nguồn" },
    });
    // MVP: webpage adapter KHÔNG tự parse doanh nghiệp trừ khi khai báo parser;
    // trả về rỗng + log để tránh tạo dữ liệu sai
    logJob(ctx.jobId, `Đã tải ${html.length} ký tự từ nguồn. Chưa khai báo bộ phân tích cấu trúc — ghi nhận nguồn cần cấu hình parser.`);
    return [];
  }
}

async function logJob(jobId: string, line: string) {
  const job = await db.collectionJob.findUnique({ where: { id: jobId }, select: { logText: true } });
  const stamp = new Date().toISOString();
  await db.collectionJob.update({
    where: { id: jobId },
    data: { logText: `${job?.logText ?? ""}[${stamp}] ${line}\n` },
  });
}

/** Registry adapter theo loại nguồn */
export function getAdapterForSource(type: string): CollectorAdapter | null {
  switch (type) {
    case "FILE_IMPORT":
    case "USER_UPLOAD":
    case "MANUAL_ENTRY":
      return new FileImportAdapter();
    case "COMPANY_WEBSITE":
    case "PUBLIC_DIRECTORY":
    case "OFFICIAL_API":
    case "OFFICIAL_REGISTRY":
      return new WebPageAdapter();
    default:
      return null;
  }
}

/**
 * Chạy một CollectionJob: kiểm tra quyền truy cập nguồn → adapter.collect → processRecords.
 * Trả về kết quả và cập nhật trạng thái job. Không tự tạo dữ liệu giả.
 */
export async function runCollectionJob(jobId: string, config: ScoringConfig): Promise<CollectorResult> {
  const job = await db.collectionJob.findUnique({ where: { id: jobId }, include: { source: true } });
  if (!job) return { status: "FAILED", rowsCollected: 0, message: "Job không tồn tại" };
  if (["CANCELLED", "FAILED", "COMPLETED"].includes(job.status)) {
    return { status: job.status as CollectorResult["status"], rowsCollected: 0, message: `Job đang ở trạng thái ${job.status}, không chạy lại` };
  }
  const source = job.source;
  if (!source.isActive) {
    await db.collectionJob.update({ where: { id: jobId }, data: { status: "FAILED", logText: "Nguồn chưa được bật (isActive=false) — nguồn cần xem xét/truy cập trước", finishedAt: new Date() } });
    return { status: "FAILED", rowsCollected: 0, message: "Nguồn chưa được bật thu thập" };
  }
  const adapter = getAdapterForSource(source.type);
  if (!adapter || !adapter.canRun(source.accessPolicy)) {
    await db.collectionJob.update({
      where: { id: jobId },
      data: { status: "FAILED", logText: `Loại nguồn ${source.type} với accessPolicy=${source.accessPolicy} chưa đủ điều kiện thu thập`, finishedAt: new Date() },
    });
    return { status: "FAILED", rowsCollected: 0, message: "Nguồn chưa đủ điều kiện truy cập/sử dụng" };
  }

  await db.collectionJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date() } });
  await db.source.update({ where: { id: source.id }, data: { lastRunAt: new Date() } });

  try {
    const rows = await adapter.collect({
      jobId, sourceId: source.id, sourceUrl: source.url,
      rateLimitPerMin: source.rateLimitPerMin,
      shouldStop: async () => {
        const j = await db.collectionJob.findUnique({ where: { id: jobId }, select: { status: true } });
        return j?.status === "PAUSED" || j?.status === "CANCELLED";
      },
    });
    if (rows.length === 0) {
      await db.collectionJob.update({
        where: { id: jobId },
        data: { status: "COMPLETED", finishedAt: new Date(), discoveredCount: 0, logText: `${job.logText ?? ""}[${new Date().toISOString()}] Không thu thập được bản ghi nào từ adapter (mạng/token/parser chưa cấu hình) — không tạo dữ liệu thay thế.\n` },
      });
      return { status: "COMPLETED", rowsCollected: 0, message: "Không có bản ghi — xem nhật ký job" };
    }
    const result = await processRecords({ sourceId: source.id, rows, config, jobId });
    await db.collectionJob.update({ where: { id: jobId }, data: { status: "COMPLETED", finishedAt: new Date() } });
    await audit({ action: "job.completed", entityType: "CollectionJob", entityId: jobId, detail: { rows: rows.length, valid: result.validRows } });
    return { status: "COMPLETED", rowsCollected: result.totalRows, message: `Xử lý ${result.totalRows} bản ghi` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.collectionJob.update({
      where: { id: jobId },
      data: { status: "FAILED", finishedAt: new Date(), errorCount: job.errorCount + 1, logText: `${job.logText ?? ""}[${new Date().toISOString()}] LỖI: ${msg}\n` },
    });
    return { status: "FAILED", rowsCollected: 0, message: msg };
  }
}
