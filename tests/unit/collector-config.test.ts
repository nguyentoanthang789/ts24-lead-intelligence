// Test — Collector Config: chuẩn hóa biên số trang / song song / timeout + pool chạy song song
import { describe, test, expect } from "bun:test";
import {
  normalizeMaxPages,
  normalizeConcurrency,
  normalizeTimeoutMs,
  validateCollectorConfig,
  DEFAULT_COLLECTOR_CONFIG,
  runWithConcurrency,
} from "../../src/server/collector-config";

describe("normalize biên", () => {
  test("maxPagesPerSource 1..1000 (nguồn sitemap lớn cần đi sâu)", () => {
    expect(normalizeMaxPages(1)).toBe(1);
    expect(normalizeMaxPages(100)).toBe(100);
    expect(normalizeMaxPages(1000)).toBe(1000);
    expect(normalizeMaxPages(0)).toBe(null);
    expect(normalizeMaxPages(1001)).toBe(null);
    expect(normalizeMaxPages("25")).toBe(25);
    expect(normalizeMaxPages(undefined)).toBe(null);
  });
  test("sourceConcurrency 1..8", () => {
    expect(normalizeConcurrency(1)).toBe(1);
    expect(normalizeConcurrency(8)).toBe(8);
    expect(normalizeConcurrency(0)).toBe(null);
    expect(normalizeConcurrency(9)).toBe(null);
  });
  test("requestTimeoutMs 5000..60000", () => {
    expect(normalizeTimeoutMs(5000)).toBe(5000);
    expect(normalizeTimeoutMs(60000)).toBe(60000);
    expect(normalizeTimeoutMs(4999)).toBe(null);
    expect(normalizeTimeoutMs(60001)).toBe(null);
  });
  test("default an toàn", () => {
    expect(validateCollectorConfig(DEFAULT_COLLECTOR_CONFIG).ok).toBe(true);
    expect(DEFAULT_COLLECTOR_CONFIG.maxPagesPerSource).toBeGreaterThanOrEqual(1);
  });
  test("validate bắt lỗi từng trường", () => {
    const v = validateCollectorConfig({ maxPagesPerSource: 0, sourceConcurrency: 99, requestTimeoutMs: 1 });
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBe(3);
  });
});

describe("runWithConcurrency", () => {
  test("chạy song song có giới hạn, giữ thứ tự kết quả", async () => {
    let active = 0;
    let maxActive = 0;
    const out = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(maxActive).toBeLessThanOrEqual(3); // không vượt concurrency
    expect(maxActive).toBeGreaterThan(1); // và có chạy song song thật
  });
  test("danh sách rỗng → rỗng", async () => {
    const out = await runWithConcurrency([], 4, async (n) => n);
    expect(out).toEqual([]);
  });
});
