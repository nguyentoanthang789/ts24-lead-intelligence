// Test — Continuous Runner: chuẩn hóa interval, validate cấu hình, điều kiện tiếp tục vòng lặp
// (pure functions — không đụng DB, không khởi động loop thật)
import { describe, test, expect } from "bun:test";
import {
  normalizeIntervalMinutes,
  validateContinuousConfig,
  shouldContinueLoop,
  DEFAULT_CONTINUOUS_CONFIG,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
} from "../../src/server/continuous";

describe("normalizeIntervalMinutes", () => {
  test("nhận giá trị hợp lệ trong biên 5..720", () => {
    expect(normalizeIntervalMinutes(10)).toBe(10);
    expect(normalizeIntervalMinutes(5)).toBe(MIN_INTERVAL_MINUTES);
    expect(normalizeIntervalMinutes(720)).toBe(MAX_INTERVAL_MINUTES);
    expect(normalizeIntervalMinutes("15")).toBe(15); // từ input form dạng chuỗi
  });
  test("làm tròn số thập phân", () => {
    expect(normalizeIntervalMinutes(9.6)).toBe(10);
    expect(normalizeIntervalMinutes(10.2)).toBe(10);
  });
  test("chặn ngoài biên và sai kiểu", () => {
    expect(normalizeIntervalMinutes(4)).toBeNull(); // dưới tối thiểu — tránh phá nguồn
    expect(normalizeIntervalMinutes(721)).toBeNull();
    expect(normalizeIntervalMinutes(0)).toBeNull();
    expect(normalizeIntervalMinutes(-5)).toBeNull();
    expect(normalizeIntervalMinutes("abc")).toBeNull();
    expect(normalizeIntervalMinutes("")).toBeNull();
    expect(normalizeIntervalMinutes(undefined)).toBeNull();
    expect(normalizeIntervalMinutes(null)).toBeNull();
    expect(normalizeIntervalMinutes(NaN)).toBeNull();
    expect(normalizeIntervalMinutes(Infinity)).toBeNull();
  });
});

describe("validateContinuousConfig", () => {
  const valid = { ...DEFAULT_CONTINUOUS_CONFIG, running: true, intervalMinutes: 10 };
  test("cấu hình đủ và đúng → ok", () => {
    expect(validateContinuousConfig(valid).ok).toBe(true);
  });
  test("chặn interval sai", () => {
    const v = validateContinuousConfig({ ...valid, intervalMinutes: 3 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("intervalMinutes");
    const v2 = validateContinuousConfig({ ...valid, intervalMinutes: "10 phút" as unknown as number });
    expect(v2.ok).toBe(false);
  });
  test("chặn thiếu/còn thiếu kiểu boolean", () => {
    const { autoRunSources, ...thieu } = valid;
    const v = validateContinuousConfig(thieu);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toContain("autoRunSources");
    const v2 = validateContinuousConfig({ ...valid, autoDiscover: "yes" as unknown as boolean });
    expect(v2.ok).toBe(false);
  });
  test("chặn running sai kiểu và null", () => {
    expect(validateContinuousConfig({ ...valid, running: 1 as unknown as boolean }).ok).toBe(false);
    expect(validateContinuousConfig(null).ok).toBe(false);
  });
});

describe("shouldContinueLoop", () => {
  test("chạy tiếp khi active và chưa yêu cầu dừng", () => {
    expect(shouldContinueLoop({ active: true, stopRequested: false })).toBe(true);
  });
  test("dừng khi yêu cầu STOP", () => {
    expect(shouldContinueLoop({ active: true, stopRequested: true })).toBe(false);
  });
  test("dừng khi không active", () => {
    expect(shouldContinueLoop({ active: false, stopRequested: false })).toBe(false);
  });
});

describe("DEFAULT_CONTINUOUS_CONFIG", () => {
  test("mặc định an toàn: chưa chạy, nghỉ 10 phút, bật đủ 4 bước", () => {
    expect(DEFAULT_CONTINUOUS_CONFIG.running).toBe(false);
    expect(DEFAULT_CONTINUOUS_CONFIG.intervalMinutes).toBe(10);
    expect(DEFAULT_CONTINUOUS_CONFIG.autoDiscover).toBe(true);
    expect(DEFAULT_CONTINUOUS_CONFIG.autoRunSources).toBe(true);
    expect(DEFAULT_CONTINUOUS_CONFIG.autoRescore).toBe(true);
    expect(DEFAULT_CONTINUOUS_CONFIG.retentionCleanup).toBe(true);
  });
});
