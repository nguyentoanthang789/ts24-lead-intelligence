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
import {
  extractCompaniesFromHtml,
  extractCompaniesFromJson,
  extractSitemapLocs,
  ExtractResult,
} from "../extract";
import { CollectorConfig, DEFAULT_COLLECTOR_CONFIG } from "../collector-config";

export type CollectorContext = {
  jobId: string;
  sourceId: string;
  sourceUrl: string | null;
  rateLimitPerMin: number;
  /** số trang tối đa mỗi lần chạy nguồn (pagination thật) */
  maxPages: number;
  /** timeout mỗi request (ms) */
  requestTimeoutMs: number;
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
    // 1) Kiểm robots trước — RESTRICTED/CHECK_FAILED thì dừng an toàn
    const robots = await checkRobots(ctx.sourceUrl, ctx.fetchImpl ?? fetch);
    if (robots.status === "RESTRICTED") {
      throw new Error(`Nguồn từ chối thu thập theo robots.txt — dừng an toàn: ${robots.note}`);
    }
    if (robots.status === "CHECK_FAILED") {
      throw new Error(`Không xác minh được điều kiện truy cập — dừng an toàn: ${robots.note}`);
    }
    // 2) Cào ĐA TRANG: trang 1 → trích xuất thật → theo link trang kế (cùng host)
    //    tới tối đa ctx.maxPages; giữ nhịp theo rateLimitPerMin của nguồn.
    const delayMs = Math.max(0, Math.ceil(60000 / Math.max(1, ctx.rateLimitPerMin)));
    const fetcher = ctx.fetchImpl ?? fetch;
    const all: ImportRow[] = [];
    const seenUrls = new Set<string>();
    const seenContent = new Set<string>();
    let url: string | null = ctx.sourceUrl;
    let via: ExtractResult["via"] = "none";
    for (let page = 1; page <= Math.max(1, ctx.maxPages) && url; page++) {
      if (ctx.shouldStop && (await ctx.shouldStop())) {
        await logJob(ctx.jobId, `Dừng an toàn theo yêu cầu tại trang ${page}`);
        break;
      }
      await sleep(delayMs); // giữ nhịp rateLimitPerMin TRƯỚC MỖI request — tôn trọng nguồn
      const res = await withRetry(
        () => fetcher(url!, { signal: AbortSignal.timeout(ctx.requestTimeoutMs), redirect: "follow" }),
        { maxRetries: 2, baseDelayMs: 800, onRetry: (n, e) => logJob(ctx.jobId, `Retry trang ${page} lần ${n}: ${e instanceof Error ? e.message : e}`) }
      );
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        if (page === 1) throw new Error(`Nguồn từ chối truy cập (HTTP ${res.status}) — dừng an toàn, không né cơ chế chống bot`);
        await logJob(ctx.jobId, `Trang ${page} bị từ chối (HTTP ${res.status}) — dừng đi sâu, giữ phần đã lấy`);
        break;
      }
      if (!res.ok) {
        if (page === 1) throw new Error(`HTTP ${res.status} khi truy cập nguồn`);
        await logJob(ctx.jobId, `Trang ${page} lỗi HTTP ${res.status} — dừng đi sâu, giữ phần đã lấy`);
        break;
      }
      const body = await res.text();
      // chống lặp vô hạn: trang trùng nội dung đã tải → dừng
      const contentKey = body.length + ":" + body.slice(0, 4000);
      if (seenContent.has(contentKey)) {
        await logJob(ctx.jobId, `Trang ${page} trùng nội dung trang trước — dừng đi sâu`);
        break;
      }
      seenContent.add(contentKey);
      await db.collectionCheckpoint.create({
        data: { jobId: ctx.jobId, cursor: JSON.stringify({ url, page }), note: `Đã tải trang ${page}` },
      });
      // SITEMAP: nguồn trỏ thẳng vào sitemap.xml → cào TỪNG trang hồ sơ company
      if (/^\s*<\?xml/i.test(body) && /<(urlset|sitemapindex)\b/i.test(body)) {
        const rows = await this.collectFromSitemap(ctx, body, all);
        return rows;
      }
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      let extracted: ExtractResult;
      if (contentType.includes("application/json") || contentType.includes("text/javascript") || body.trimStart().startsWith("{")) {
        const rows = extractCompaniesFromJson(body);
        extracted = { rows, nextLinks: [], via: rows.length ? "json" : "none" };
      } else {
        extracted = extractCompaniesFromHtml(body, url);
      }
      via = extracted.via;
      seenUrls.add(url);
      all.push(...extracted.rows);
      await logJob(ctx.jobId, `Trang ${page} (${url}): ${extracted.rows.length} bản ghi — tổng ${all.length}`);
      // link trang kế: cùng host, chưa đi qua
      url = extracted.nextLinks.find((u) => !seenUrls.has(u)) ?? null;
      if (page === 1) {
        await db.collectionCheckpoint.create({
          data: { jobId: ctx.jobId, cursor: JSON.stringify({ via, page: 1, rows: extracted.rows.length }), note: `Trích xuất qua ${via}` },
        });
      }
    }
    if (via === "none" && all.length === 0) {
      await logJob(ctx.jobId, `Không nhận ra cấu trúc danh bạ trên trang — ghi nhận nguồn cần xem xét parser. KHÔNG tạo dữ liệu thay thế.`);
    }
    return all;
  }

  /**
   * Chế độ sitemap: nguồn trỏ tới sitemap.xml (nguồn chủ động công khai danh sách
   * URL cho bot — robots.txt của nguồn cho phép). sitemapindex → vào tối đa 2 sitemap
   * con (ưu tiên sitemap công ty) → urlset → cào TỪNG trang hồ sơ với nhịp rateLimit,
   * tới tối đa maxPages request. 401/403/429 → dừng an toàn, giữ phần đã lấy.
   */
  private async collectFromSitemap(ctx: CollectorContext, xml: string, all: ImportRow[]): Promise<ImportRow[]> {
    const delayMs = Math.max(0, Math.ceil(60000 / Math.max(1, ctx.rateLimitPerMin)));
    const fetcher = ctx.fetchImpl ?? fetch;
    const origin = new URL(ctx.sourceUrl!).origin;
    const { kind, locs: firstLocs } = extractSitemapLocs(xml);
    let pageUrls: string[] = [];
    if (kind === "urlset") {
      pageUrls = firstLocs;
    } else {
      // sitemapindex: chọn sitemap con cùng host, ưu tiên sitemap công ty
      const children = firstLocs
        .filter((u) => {
          try { return new URL(u).origin === origin; } catch { return false; }
        })
        .sort((a, b) => Number(/compan|cong-ty|congty/i.test(b)) - Number(/compan|cong-ty|congty/i.test(a)))
        .slice(0, 2);
      for (const child of children) {
        if (ctx.shouldStop && (await ctx.shouldStop())) break;
        await sleep(delayMs);
        try {
          const res = await fetcher(child, { signal: AbortSignal.timeout(ctx.requestTimeoutMs) });
          if (!res.ok) {
            await logJob(ctx.jobId, `Sitemap con ${child} HTTP ${res.status} — bỏ qua`);
            continue;
          }
          const txt = await res.text();
          const childLocs = extractSitemapLocs(txt).locs;
          pageUrls.push(...childLocs);
          await db.collectionCheckpoint.create({
            data: { jobId: ctx.jobId, cursor: JSON.stringify({ sitemap: child, urls: childLocs.length }), note: `Đọc sitemap con` },
          });
        } catch (e) {
          await logJob(ctx.jobId, `Lỗi tải sitemap con ${child}: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
    // lọc cùng host + khử trùng lặp
    const seen = new Set<string>();
    const targets: string[] = [];
    for (const u of pageUrls) {
      try {
        const x = new URL(u);
        if (x.origin !== origin || seen.has(u)) continue;
        seen.add(u);
        targets.push(u);
      } catch { /* bỏ URL hỏng */ }
    }
    const budget = Math.max(0, Math.max(1, ctx.maxPages) - 1); // trừ 1 request gốc
    await logJob(ctx.jobId, `Chế độ sitemap: ${targets.length} URL hồ sơ, cào tối đa ${budget}`);
    for (let i = 0; i < targets.length && i < budget; i++) {
      if (ctx.shouldStop && (await ctx.shouldStop())) {
        await logJob(ctx.jobId, `Dừng an toàn theo yêu cầu tại hồ sơ ${i + 1}`);
        break;
      }
      await sleep(delayMs);
      let res: Response;
      try {
        res = await withRetry(
          () => fetcher(targets[i], { signal: AbortSignal.timeout(ctx.requestTimeoutMs), redirect: "follow" }),
          { maxRetries: 1, baseDelayMs: 800 }
        );
      } catch (e) {
        await logJob(ctx.jobId, `Hồ sơ ${i + 1} lỗi mạng: ${e instanceof Error ? e.message : e} — bỏ qua`);
        continue;
      }
      if (res.status === 401 || res.status === 403 || res.status === 429) {
        await logJob(ctx.jobId, `Nguồn từ chối (HTTP ${res.status}) tại ${targets[i]} — dừng an toàn, giữ phần đã lấy`);
        break;
      }
      if (!res.ok) {
        await logJob(ctx.jobId, `Hồ sơ ${i + 1} HTTP ${res.status} — bỏ qua`);
        continue;
      }
      const b = await res.text();
      await db.collectionCheckpoint.create({
        data: { jobId: ctx.jobId, cursor: JSON.stringify({ url: targets[i], idx: i + 1 }), note: `Đã tải hồ sơ ${i + 1}` },
      });
      const extracted = extractCompaniesFromHtml(b, targets[i]);
      all.push(...extracted.rows);
      await logJob(ctx.jobId, `Hồ sơ ${i + 1}/${Math.min(targets.length, budget)}: ${extracted.rows.length} bản ghi — tổng ${all.length}`);
    }
    if (all.length === 0) {
      await logJob(ctx.jobId, `Sitemap không cho bản ghi nào — KHÔNG tạo dữ liệu thay thế.`);
    }
    return all;
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

export type RunJobOptions = {
  /** inject fetch để test không chạy mạng thật */
  fetchImpl?: typeof fetch;
  /** cấu hình tốc độ thu thập (nếu bỏ trống dùng DEFAULT) */
  collector?: CollectorConfig;
};

/**
 * Chạy một CollectionJob: kiểm tra quyền truy cập nguồn → adapter.collect → processRecords.
 * Trả về kết quả và cập nhật trạng thái job. Không tự tạo dữ liệu giả.
 */
export async function runCollectionJob(jobId: string, config: ScoringConfig, opts: RunJobOptions = {}): Promise<CollectorResult> {
  const collector = opts.collector ?? DEFAULT_COLLECTOR_CONFIG;
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
      maxPages: collector.maxPagesPerSource,
      requestTimeoutMs: collector.requestTimeoutMs,
      fetchImpl: opts.fetchImpl,
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

export type SourceJobOutcome = {
  sourceId: string;
  sourceName: string;
  status: CollectorResult["status"];
  rows: number;
  message: string;
};

/**
 * Chạy SONG SONG job thu thập cho nhiều nguồn mạng đang bật với giới hạn
 * concurrency (mỗi nguồn vẫn tự giữ nhịp rateLimitPerMin của chính nó).
 * Nguồn file/manual không có gì để thu — được bỏ qua từ trước khi gọi.
 */
export async function runSourceJobsParallel(
  sources: { id: string; name: string }[],
  config: ScoringConfig,
  opts: { concurrency: number; fetchImpl?: typeof fetch; collector?: CollectorConfig }
): Promise<SourceJobOutcome[]> {
  const { runWithConcurrency } = await import("../collector-config");
  return runWithConcurrency(sources, Math.max(1, opts.concurrency), async (s) => {
    const job = await db.collectionJob.create({ data: { sourceId: s.id, status: "PENDING" } });
    const res = await runCollectionJob(job.id, config, { fetchImpl: opts.fetchImpl, collector: opts.collector });
    return {
      sourceId: s.id,
      sourceName: s.name,
      status: res.status,
      rows: res.rowsCollected,
      message: res.message,
    };
  });
}
