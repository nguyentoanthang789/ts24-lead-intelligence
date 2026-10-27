// Test — Scheduler: parse giờ, quy đổi múi giờ, điều kiện bắn, lần chạy tới (pure functions)
// Không đụng DB, không đợi thời gian thật.
import { describe, test, expect } from "bun:test";
import {
  parseTimeHHMM,
  zonedWall,
  dayStringInTz,
  shouldFireNow,
  computeNextRunAt,
  validateSchedulerConfig,
  DEFAULT_SCHEDULER_CONFIG,
} from "../../src/server/scheduler";

const baseCfg = { ...DEFAULT_SCHEDULER_CONFIG, enabled: true, runAt: "09:30", timezone: "Asia/Ho_Chi_Minh" };

describe("parseTimeHHMM", () => {
  test("nhận dạng hợp lệ", () => {
    expect(parseTimeHHMM("09:30")).toEqual({ hh: 9, mm: 30 });
    expect(parseTimeHHMM("9:05")).toEqual({ hh: 9, mm: 5 });
    expect(parseTimeHHMM(" 23:59 ")).toEqual({ hh: 23, mm: 59 });
  });
  test("chặn sai định dạng / ngoài biên", () => {
    expect(parseTimeHHMM("24:00")).toBeNull();
    expect(parseTimeHHMM("09:60")).toBeNull();
    expect(parseTimeHHMM("abc")).toBeNull();
    expect(parseTimeHHMM("0930")).toBeNull();
    expect(parseTimeHHMM("")).toBeNull();
  });
});

describe("zonedWall / dayStringInTz — quy đổi múi giờ", () => {
  test("2026-10-27T03:15:00Z ở Asia/Ho_Chi_Minh là 10:15 ngày 2026-10-27", () => {
    const w = zonedWall(new Date("2026-10-27T03:15:00Z"), "Asia/Ho_Chi_Minh");
    expect(w).toEqual({ y: 2026, mo: 10, d: 27, hh: 10, mm: 15 });
    expect(dayStringInTz(new Date("2026-10-27T03:15:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-27");
  });
  test("UTC hoạt động đúng", () => {
    const w = zonedWall(new Date("2026-10-27T09:30:00Z"), "UTC");
    expect(w.hh).toBe(9);
    expect(w.mm).toBe(30);
  });
});

describe("shouldFireNow — bắn đúng phút, không bắn 2 lần trong ngày", () => {
  test("đúng 09:30 +07, hôm nay chưa chạy → true", () => {
    const now = new Date("2026-10-27T02:30:00Z"); // 09:30 +07
    expect(shouldFireNow(now, { ...baseCfg, lastRunDay: "2026-10-26" })).toBe(true);
  });
  test("đã chạy hôm nay → false (chống chạy 2 lần)", () => {
    const now = new Date("2026-10-27T02:30:00Z");
    expect(shouldFireNow(now, { ...baseCfg, lastRunDay: "2026-10-27" })).toBe(false);
  });
  test("sai phút → false", () => {
    const now = new Date("2026-10-27T02:31:00Z"); // 09:31 +07
    expect(shouldFireNow(now, { ...baseCfg, lastRunDay: "2026-10-26" })).toBe(false);
  });
  test("disabled → false kể cả đúng giờ", () => {
    const now = new Date("2026-10-27T02:30:00Z");
    expect(shouldFireNow(now, { ...baseCfg, enabled: false, lastRunDay: null })).toBe(false);
  });
  test("runAt sai định dạng → false, không crash", () => {
    const now = new Date("2026-10-27T02:30:00Z");
    expect(shouldFireNow(now, { ...baseCfg, runAt: "9h30", lastRunDay: null })).toBe(false);
  });
});

describe("computeNextRunAt — lần chạy tới theo timezone", () => {
  test("trước giờ chạy → cùng ngày (09:00 +07 → 09:30 +07)", () => {
    const now = new Date("2026-10-27T02:00:00Z"); // 09:00 +07
    const next = computeNextRunAt(now, baseCfg)!;
    expect(next.toISOString()).toBe("2026-10-27T02:30:00.000Z");
  });
  test("sau giờ chạy → ngày mai (10:00 +07 → 09:30 +07 hôm sau)", () => {
    const now = new Date("2026-10-27T03:00:00Z"); // 10:00 +07
    const next = computeNextRunAt(now, baseCfg)!;
    expect(next.toISOString()).toBe("2026-10-28T02:30:00.000Z");
  });
  test("tràn tháng: 31/10 sau giờ chạy → 01/11", () => {
    const now = new Date("2026-10-31T03:00:00Z"); // 10:00 +07 ngày 31-10
    const next = computeNextRunAt(now, baseCfg)!;
    expect(next.toISOString()).toBe("2026-11-01T02:30:00.000Z");
  });
  test("runAt không hợp lệ → null", () => {
    expect(computeNextRunAt(new Date(), { ...baseCfg, runAt: "xx" })).toBeNull();
  });
});

describe("validateSchedulerConfig", () => {
  test("cấu hình hợp lệ → ok", () => {
    const v = validateSchedulerConfig({
      enabled: true, runAt: "09:30", timezone: "Asia/Ho_Chi_Minh",
      autoDiscover: true, autoRunSources: true, autoImportInbox: true, autoRescore: true, retentionCleanup: true,
    });
    expect(v.ok).toBe(true);
  });
  test("giờ sai / timezone sai / thiếu boolean → lỗi rõ ràng", () => {
    const v = validateSchedulerConfig({
      enabled: true, runAt: "25:00", timezone: "KhongPhaiZone",
      autoDiscover: true, autoRunSources: "yes", autoRescore: true, retentionCleanup: true,
    });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("runAt");
    expect(v.errors.join(" ")).toContain("timezone");
    expect(v.errors.join(" ")).toContain("autoRunSources");
  });
});
