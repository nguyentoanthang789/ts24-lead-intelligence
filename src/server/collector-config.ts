// ============================================================
// Module 15 — Collector Config: cấu hình TỐC ĐỘ thu thập
// - maxPagesPerSource: số trang tối đa bot đi sâu mỗi nguồn mỗi lần chạy
//   (pagination thật — mỗi trang lấy được cả chục lead → nhân số lead/vòng)
// - sourceConcurrency: số nguồn chạy SONG SONG trong một vòng pipeline
// - requestTimeoutMs: timeout mỗi request
// Ranh giới: vẫn tôn trọng robots.txt + rateLimitPerMin từng nguồn —
// tăng tốc bằng cách khai thác HẾT giới hạn cho phép, KHÔNG né chống bot.
// ============================================================

import { db } from "@/lib/db";
import { audit } from "./compliance";

export type CollectorConfig = {
  maxPagesPerSource: number;
  sourceConcurrency: number;
  requestTimeoutMs: number;
};

export const DEFAULT_COLLECTOR_CONFIG: CollectorConfig = {
  maxPagesPerSource: 10,
  sourceConcurrency: 4,
  requestTimeoutMs: 15000,
};

export const MIN_MAX_PAGES = 1;
export const MAX_MAX_PAGES = 100;
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 8;
export const MIN_TIMEOUT_MS = 5000;
export const MAX_TIMEOUT_MS = 60000;

// ---------------- Pure helpers (unit-test được) ----------------

function clampInt(v: unknown, min: number, max: number): number | null {
  let n: number;
  if (typeof v === "number") n = Math.round(v);
  else if (typeof v === "string" && v.trim() !== "") n = Math.round(Number(v));
  else return null;
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

export function normalizeMaxPages(v: unknown): number | null {
  return clampInt(v, MIN_MAX_PAGES, MAX_MAX_PAGES);
}

export function normalizeConcurrency(v: unknown): number | null {
  return clampInt(v, MIN_CONCURRENCY, MAX_CONCURRENCY);
}

export function normalizeTimeoutMs(v: unknown): number | null {
  return clampInt(v, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

export function validateCollectorConfig(cfg: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = cfg as Partial<CollectorConfig> | null;
  if (!c || typeof c !== "object") return { ok: false, errors: ["Cấu hình trống"] };
  if (normalizeMaxPages(c.maxPagesPerSource) === null) {
    errors.push(`maxPagesPerSource phải là số nguyên ${MIN_MAX_PAGES}..${MAX_MAX_PAGES}`);
  }
  if (normalizeConcurrency(c.sourceConcurrency) === null) {
    errors.push(`sourceConcurrency phải là số nguyên ${MIN_CONCURRENCY}..${MAX_CONCURRENCY}`);
  }
  if (normalizeTimeoutMs(c.requestTimeoutMs) === null) {
    errors.push(`requestTimeoutMs phải là số nguyên ${MIN_TIMEOUT_MS}..${MAX_TIMEOUT_MS}`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------- Lưu đọc (AppSetting) ----------------

const KEY = "collector_config";

export async function getCollectorConfig(): Promise<CollectorConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_COLLECTOR_CONFIG;
  try {
    const parsed = JSON.parse(row.value) as Partial<CollectorConfig>;
    const merged = { ...DEFAULT_COLLECTOR_CONFIG, ...parsed };
    if (validateCollectorConfig(merged).ok) return merged;
    return DEFAULT_COLLECTOR_CONFIG;
  } catch {
    return DEFAULT_COLLECTOR_CONFIG;
  }
}

export async function saveCollectorConfig(cfg: CollectorConfig, actor = "operator"): Promise<CollectorConfig> {
  const v = validateCollectorConfig(cfg);
  if (!v.ok) throw new Error(v.errors.join("; "));
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(cfg) },
    update: { value: JSON.stringify(cfg) },
  });
  await audit({
    actor,
    action: "collector.config_updated",
    entityType: "AppSetting",
    entityId: KEY,
    detail: { ...cfg },
  });
  return cfg;
}

/**
 * Pool chạy song song có giới hạn — giữ nguyên thứ tự kết quả theo input.
 * Pure điều phối (không đụng DB) — test được với task giả.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
