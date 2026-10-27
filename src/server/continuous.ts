// ============================================================
// Module 12 — Continuous Runner: NÚT START chạy TOÀN BỘ pipeline
// LIÊN TỤC KHÔNG NGHỈ.
//
// Bấm START:
//   1. Chạy ngay một vòng pipeline đầy đủ:
//      dò nguồn mới → thu thập các nguồn mạng đang bật → chấm điểm lại
//      toàn bộ lead → dọn bản ghi quá hạn lưu giữ.
//   2. Hết vòng, NGHỈ một khoảng ngắn (intervalMinutes, mặc định 10 phút,
//      tối thiểu 5) rồi chạy tiếp vòng mới — lặp vô hạn 24/7 cho tới khi
//      bấm STOP hoặc tắt server.
//   3. Đang chạy mà restart server → tự phục hồi lại chế độ chạy liên tục
//      (resumeContinuousIfNeeded gọi từ instrumentation).
//
// An toàn & tuân thủ:
//   - Dùng chung mutex với scheduler theo lịch: cùng lúc chỉ MỘT pipeline —
//     vòng continuous trúng giờ lịch sẽ tự nhường và thử lại ở vòng sau.
//   - Lỗi 1 vòng KHÔNG dừng máy: ghi audit + đếm số lỗi liên tiếp, vẫn nghỉ
//     interval rồi chạy vòng kế (không nghỉ theo yêu cầu vận hành).
//   - Vẫn tôn trọng robots.txt, hạn tốc độ từng nguồn, checkpoint —KHÔNG
//     tự gửi tin nhắn Zalo (gửi tin 100% thủ công).
// ============================================================

import { db } from "@/lib/db";
import { audit } from "./compliance";
import { runPipelineSteps } from "./scheduler";

export type ContinuousConfig = {
  running: boolean; // trạng thái mong muốn — true thì server restart cũng tự chạy lại
  intervalMinutes: number; // thời gian nghỉ giữa các vòng (0..720) — 0 = KHÔNG NGHỈ
  autoDiscover: boolean;
  autoRunSources: boolean;
  autoImportInbox: boolean;
  autoRescore: boolean;
  retentionCleanup: boolean;
};

export const DEFAULT_CONTINUOUS_CONFIG: ContinuousConfig = {
  running: false,
  intervalMinutes: 0, // mặc định KHÔNG NGHỈ — chạy vòng mới ngay sau vòng trước
  autoDiscover: true,
  autoRunSources: true,
  autoImportInbox: true,
  autoRescore: true,
  retentionCleanup: true,
};

export const MIN_INTERVAL_MINUTES = 0;
export const MAX_INTERVAL_MINUTES = 720;
/** Khi interval = 0 (không nghỉ) vẫn chốt 5 giây giữa các vòng để không ép CPU/DB */
export const NO_REST_COOLDOWN_MS = 5_000;

// ---------------- Pure helpers (unit-test được, không đụng DB) ----------------

/** Chuẩn hóa interval: số nguyên 0..720 phút (0 = không nghỉ), null nếu sai */
export function normalizeIntervalMinutes(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") n = Math.round(v);
  else if (typeof v === "string" && v.trim() !== "") n = Math.round(Number(v));
  else return null;
  if (!Number.isFinite(n)) return null;
  if (n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) return null;
  return n;
}

export function validateContinuousConfig(cfg: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = cfg as Partial<ContinuousConfig> | null;
  if (!c || typeof c !== "object") return { ok: false, errors: ["Cấu hình trống"] };
  if (typeof c.running !== "boolean") errors.push("running phải là boolean");
  if (normalizeIntervalMinutes(c.intervalMinutes) === null) {
    errors.push(`intervalMinutes phải là số nguyên ${MIN_INTERVAL_MINUTES}..${MAX_INTERVAL_MINUTES} (phút, 0 = không nghỉ)`);
  }
  for (const k of ["autoDiscover", "autoRunSources", "autoImportInbox", "autoRescore", "retentionCleanup"] as const) {
    if (typeof c[k] !== "boolean") errors.push(`${k} phải là boolean`);
  }
  return { ok: errors.length === 0, errors };
}

/** Điều kiện tiếp tục vòng lặp — tách pure để test */
export function shouldContinueLoop(state: { active: boolean; stopRequested: boolean }): boolean {
  return state.active && !state.stopRequested;
}

// ---------------- Cấu hình (AppSetting) ----------------

const KEY = "continuous_config";

export async function getContinuousConfig(): Promise<ContinuousConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_CONTINUOUS_CONFIG;
  try {
    const parsed = JSON.parse(row.value) as Partial<ContinuousConfig>;
    const merged = { ...DEFAULT_CONTINUOUS_CONFIG, ...parsed };
    if (validateContinuousConfig(merged).ok) return merged;
    // cấu hình hỏng — trả mặc định (giữ running:false an toàn, không tự chạy lại)
    return DEFAULT_CONTINUOUS_CONFIG;
  } catch {
    return DEFAULT_CONTINUOUS_CONFIG;
  }
}

export async function saveContinuousConfig(cfg: ContinuousConfig, actor = "operator"): Promise<ContinuousConfig> {
  const v = validateContinuousConfig(cfg);
  if (!v.ok) throw new Error(v.errors.join("; "));
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(cfg) },
    update: { value: JSON.stringify(cfg) },
  });
  await audit({
    actor,
    action: "continuous.config_updated",
    entityType: "ContinuousRunner",
    entityId: KEY,
    detail: {
      running: cfg.running, intervalMinutes: cfg.intervalMinutes,
      autoDiscover: cfg.autoDiscover, autoRunSources: cfg.autoRunSources,
      autoImportInbox: cfg.autoImportInbox, autoRescore: cfg.autoRescore,
      retentionCleanup: cfg.retentionCleanup,
    },
  });
  return cfg;
}

export async function updateContinuousConfig(
  patch: Partial<Omit<ContinuousConfig, "running">>,
  actor = "operator"
): Promise<ContinuousConfig> {
  const cur = await getContinuousConfig();
  const merged: ContinuousConfig = { ...cur, ...patch };
  const v = validateContinuousConfig(merged);
  if (!v.ok) throw new Error(v.errors.join("; "));
  return saveContinuousConfig(merged, actor);
}

// ---------------- Runtime in-process (singleton theo globalThis) ----------------

type ContinuousRuntime = {
  active: boolean; // loop đang sống
  stopRequested: boolean; // yêu cầu dừng sau vòng hiện tại
  cycleCount: number; // số vòng đã hoàn tất
  failCount: number; // số vòng lỗi liên tiếp
  startedAt: string | null;
  startedBy: string | null;
  runningCycle: boolean; // đang chạy một vòng
  currentCycleStartedAt: string | null;
  lastCycleAt: string | null;
  lastCycleResult: { steps: string[]; ok: boolean; skipped?: boolean } | null;
  lastError: string | null;
  nextCycleAt: string | null;
  sleepTimer: ReturnType<typeof setTimeout> | null;
  wake: (() => void) | null;
};

const g = globalThis as typeof globalThis & { __ts24ContinuousRuntime?: ContinuousRuntime };

function runtime(): ContinuousRuntime {
  if (!g.__ts24ContinuousRuntime) {
    g.__ts24ContinuousRuntime = {
      active: false, stopRequested: false, cycleCount: 0, failCount: 0,
      startedAt: null, startedBy: null, runningCycle: false, currentCycleStartedAt: null,
      lastCycleAt: null, lastCycleResult: null, lastError: null, nextCycleAt: null,
      sleepTimer: null, wake: null,
    };
  }
  return g.__ts24ContinuousRuntime;
}

export async function getContinuousStatus() {
  const cfg = await getContinuousConfig();
  const rt = runtime();
  return {
    config: cfg,
    active: rt.active,
    cycleCount: rt.cycleCount,
    failCount: rt.failCount,
    startedAt: rt.startedAt,
    startedBy: rt.startedBy,
    runningCycle: rt.runningCycle,
    currentCycleStartedAt: rt.currentCycleStartedAt,
    lastCycleAt: rt.lastCycleAt,
    lastCycleResult: rt.lastCycleResult,
    lastError: rt.lastError,
    nextCycleAt: rt.nextCycleAt,
    uptimeMinutes: rt.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(rt.startedAt)) / 60000)) : 0,
  };
}

// ---------------- Ngủ có thể đánh thức (STOP dừng ngay không đợi hết interval) ----------------

async function sleepInterruptible(ms: number, rt: ContinuousRuntime): Promise<void> {
  await new Promise<void>((resolve) => {
    rt.wake = resolve;
    rt.sleepTimer = setTimeout(() => {
      rt.wake = null;
      rt.sleepTimer = null;
      resolve();
    }, ms);
  });
  rt.wake = null;
  rt.sleepTimer = null;
}

// ---------------- Vòng lặp chính ----------------

async function loop(): Promise<void> {
  const rt = runtime();
  try {
    while (shouldContinueLoop({ active: rt.active, stopRequested: rt.stopRequested })) {
      const cfg = await getContinuousConfig();
      rt.runningCycle = true;
      rt.currentCycleStartedAt = new Date().toISOString();
      try {
        const result = await runPipelineSteps(
          {
            autoDiscover: cfg.autoDiscover,
            autoRunSources: cfg.autoRunSources,
            autoImportInbox: cfg.autoImportInbox,
            autoRescore: cfg.autoRescore,
            retentionCleanup: cfg.retentionCleanup,
          },
          "continuous"
        );
        rt.lastCycleAt = result.finishedAt;
        if (result.ok) {
          rt.cycleCount++;
          rt.failCount = 0;
          rt.lastCycleResult = { steps: result.steps, ok: true };
          rt.lastError = null;
          await audit({
            actor: "continuous-runner",
            action: "continuous.cycle_finished",
            entityType: "ContinuousRunner",
            detail: { cycle: rt.cycleCount, steps: result.steps },
          });
        } else {
          // Bị mutex chặn (pipeline khác đang chạy, VD trúng giờ lịch 09:30) → vòng bỏ qua, không phải lỗi
          rt.lastCycleResult = { steps: [], ok: false, skipped: true };
        }
      } catch (err) {
        rt.failCount++;
        rt.lastError = err instanceof Error ? err.message : String(err);
        rt.lastCycleResult = { steps: [], ok: false };
        await audit({
          actor: "continuous-runner",
          action: "continuous.cycle_failed",
          entityType: "ContinuousRunner",
          detail: { cycle: rt.cycleCount + 1, error: rt.lastError, consecutiveFails: rt.failCount },
        });
      } finally {
        rt.runningCycle = false;
        rt.currentCycleStartedAt = null;
      }

      if (!shouldContinueLoop({ active: rt.active, stopRequested: rt.stopRequested })) break;

      // Đọc lại cấu hình mỗi vòng để nhặt interval/bộ bước mới mà không cần restart
      const cfgNext = await getContinuousConfig();
      // interval = 0 → KHÔNG NGHỈ: chỉ chốt NO_REST_COOLDOWN_MS rồi chạy vòng mới ngay
      const restMs = cfgNext.intervalMinutes === 0 ? NO_REST_COOLDOWN_MS : cfgNext.intervalMinutes * 60_000;
      rt.nextCycleAt = new Date(Date.now() + restMs).toISOString();
      await sleepInterruptible(restMs, rt);
      rt.nextCycleAt = null;
    }
  } finally {
    rt.active = false;
    rt.stopRequested = false;
    rt.nextCycleAt = null;
    // Đồng bộ config nếu loop chết ngoài ý muốn (lỗi hệ thống) — không tự chạy lại bừa
    try {
      const cfg = await getContinuousConfig();
      if (cfg.running) await saveContinuousConfig({ ...cfg, running: false }, "continuous-runner");
    } catch {
      // bỏ qua — không làm crash server
    }
  }
}

// ---------------- Điều khiển ----------------

export async function startContinuous(
  actor = "operator"
): Promise<{ started: boolean; message?: string }> {
  const rt = runtime();
  if (rt.active) {
    return { started: false, message: "Chế độ chạy liên tục đang bật rồi" };
  }
  const cfg = await saveContinuousConfig({ ...(await getContinuousConfig()), running: true }, actor);
  rt.active = true;
  rt.stopRequested = false;
  rt.startedAt = new Date().toISOString();
  rt.startedBy = actor;
  rt.nextCycleAt = null;
  await audit({
    actor,
    action: "continuous.started",
    entityType: "ContinuousRunner",
    detail: { intervalMinutes: cfg.intervalMinutes, autoDiscover: cfg.autoDiscover, autoRunSources: cfg.autoRunSources },
  });
  void loop(); // chạy nền — không block request
  return { started: true };
}

export async function stopContinuous(
  actor = "operator"
): Promise<{ stopped: boolean; message?: string }> {
  const rt = runtime();
  if (!rt.active && !rt.runningCycle) {
    await saveContinuousConfig({ ...(await getContinuousConfig()), running: false }, actor);
    return { stopped: false, message: "Chế độ chạy liên tục chưa bật" };
  }
  rt.stopRequested = true;
  rt.active = false;
  rt.nextCycleAt = null;
  // Đánh thức vòng đang ngủ để thoát ngay (vòng đang chạy sẽ chạy xong tự nhiên)
  if (rt.sleepTimer) clearTimeout(rt.sleepTimer);
  if (rt.wake) {
    const wake = rt.wake;
    rt.wake = null;
    wake();
  }
  await saveContinuousConfig({ ...(await getContinuousConfig()), running: false }, actor);
  await audit({
    actor,
    action: "continuous.stopped",
    entityType: "ContinuousRunner",
    detail: { cycleCount: rt.cycleCount, startedAt: rt.startedAt },
  });
  return { stopped: true };
}

/** Gọi 1 lần từ instrumentation — server vừa restart: nếu config.running thì tự chạy lại */
export async function resumeContinuousIfNeeded(): Promise<void> {
  try {
    const cfg = await getContinuousConfig();
    if (cfg.running) {
      console.log("[continuous] phục hồi chế độ chạy liên tục sau khi server khởi động lại");
      await startContinuous("system-resume");
    }
  } catch (err) {
    console.error("[continuous] phục hồi thất bại:", err instanceof Error ? err.message : err);
  }
}
