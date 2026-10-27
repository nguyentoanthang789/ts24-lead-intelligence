// ============================================================
// Module 11 — Auto-Run Scheduler: tự chạy pipeline dữ liệu theo lịch hằng ngày
// Tick mỗi phút; bắn khi giờ:phút (theo timezone cấu hình) khớp và chưa chạy
// trong ngày hôm đó (theo chính timezone đó).
// Việc tự động bao gồm: dò nguồn (tuỳ chọn) → chạy job các nguồn mạng ĐÃ BẬT
// → chấm điểm lại toàn bộ → dọn bản ghi quá hạn lưu giữ → ghi audit.
// KHÔNG bao giờ tự gửi tin nhắn Zalo — gửi tin vẫn 100% thủ công.
// ============================================================

import { db } from "@/lib/db";
import { audit } from "./compliance";
import { getScoringConfig } from "./settings";
import { rescoreCompanies } from "./import-pipeline";
import { runCollectionJob } from "./sources/adapters";
import { probeAndRegister } from "./discovery";

export type SchedulerConfig = {
  enabled: boolean;
  runAt: string; // "HH:MM"
  timezone: string; // IANA, VD: Asia/Ho_Chi_Minh
  autoDiscover: boolean;
  autoRunSources: boolean;
  autoRescore: boolean;
  retentionCleanup: boolean;
  lastRunAt: string | null; // ISO instant lần chạy gần nhất
  lastRunDay: string | null; // "YYYY-MM-DD" theo timezone — chống chạy 2 lần/ngày
};

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  enabled: false,
  runAt: "09:30",
  timezone: "Asia/Ho_Chi_Minh",
  autoDiscover: true,
  autoRunSources: true,
  autoRescore: true,
  retentionCleanup: true,
  lastRunAt: null,
  lastRunDay: null,
};

const KEY = "scheduler_config";

// ---------------- Pure time helpers (unit-test được, không đụng DB) ----------------

export function parseTimeHHMM(v: string): { hh: number; mm: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

/** Giờ/phút địa phương của một instant theo timezone (minute precision) */
export function zonedWall(
  now: Date,
  tz: string
): { y: number; mo: number; d: number; hh: number; mm: number } {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = dtf.formatToParts(now);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "0", 10);
  return { y: get("year"), mo: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

export function dayStringInTz(now: Date, tz: string): string {
  const w = zonedWall(now, tz);
  return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** Offset (ms) của timezone tại một instant đã align phút */
function tzOffsetMs(instantMinuteAligned: number, tz: string): number {
  const w = zonedWall(new Date(instantMinuteAligned), tz);
  const asUTC = Date.UTC(w.y, w.mo - 1, w.d, w.hh, w.mm);
  return asUTC - instantMinuteAligned;
}

/** Instant tương ứng với giờ địa phương y-m-d hh:mm trong tz (refine 1 lần, đủ cho minute-precision) */
function wallToInstant(y: number, mo: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const off = tzOffsetMs(guess, tz);
  return new Date(guess - off);
}

/** Có bắn pipeline tại thời điểm `now` không: đúng phút cấu hình + chưa chạy trong ngày */
export function shouldFireNow(now: Date, cfg: SchedulerConfig): boolean {
  if (!cfg.enabled) return false;
  const t = parseTimeHHMM(cfg.runAt);
  if (!t) return false;
  const wall = zonedWall(now, cfg.timezone);
  if (wall.hh !== t.hh || wall.mm !== t.mm) return false;
  return dayStringInTz(now, cfg.timezone) !== cfg.lastRunDay;
}

/** Lần chạy tới (dựa vào now + timezone) — chỉ để hiển thị */
export function computeNextRunAt(now: Date, cfg: SchedulerConfig): Date | null {
  const t = parseTimeHHMM(cfg.runAt);
  if (!t) return null;
  const w = zonedWall(now, cfg.timezone);
  const sameDay = wallToInstant(w.y, w.mo, w.d, t.hh, t.mm, cfg.timezone);
  if (sameDay.getTime() > now.getTime()) return sameDay;
  // ngày mai — Date.UTC xử lý tràn tháng/năm tự động
  const tomorrowUtc = new Date(Date.UTC(w.y, w.mo - 1, w.d + 1));
  return wallToInstant(
    tomorrowUtc.getUTCFullYear(),
    tomorrowUtc.getUTCMonth() + 1,
    tomorrowUtc.getUTCDate(),
    t.hh, t.mm, cfg.timezone
  );
}

export function isIANAZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateSchedulerConfig(cfg: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const c = cfg as Partial<SchedulerConfig> | null;
  if (!c || typeof c !== "object") return { ok: false, errors: ["Cấu hình trống"] };
  if (typeof c.enabled !== "boolean") errors.push("enabled phải là boolean");
  const t = typeof c.runAt === "string" ? parseTimeHHMM(c.runAt) : null;
  if (!t) errors.push("runAt phải có dạng HH:MM (VD 09:30)");
  if (typeof c.timezone !== "string" || !isIANAZone(c.timezone)) {
    errors.push("timezone phải là tên IANA hợp lệ (VD Asia/Ho_Chi_Minh)");
  }
  for (const k of ["autoDiscover", "autoRunSources", "autoRescore", "retentionCleanup"] as const) {
    if (typeof c[k] !== "boolean") errors.push(`${k} phải là boolean`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------- Cấu hình (AppSetting) ----------------

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  const row = await db.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return DEFAULT_SCHEDULER_CONFIG;
  try {
    const parsed = JSON.parse(row.value) as Partial<SchedulerConfig>;
    const merged = { ...DEFAULT_SCHEDULER_CONFIG, ...parsed };
    if (validateSchedulerConfig(merged).ok) return merged;
    // cấu hình hỏng — giữ lại dấu vết lần chạy để không bắn trùng, phần còn trả mặc định
    return {
      ...DEFAULT_SCHEDULER_CONFIG,
      lastRunAt: merged.lastRunAt ?? null,
      lastRunDay: merged.lastRunDay ?? null,
    };
  } catch {
    return DEFAULT_SCHEDULER_CONFIG;
  }
}

export async function saveSchedulerConfig(cfg: SchedulerConfig, actor = "operator"): Promise<void> {
  await db.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: JSON.stringify(cfg) },
    update: { value: JSON.stringify(cfg) },
  });
  await audit({
    actor,
    action: "scheduler.config_updated",
    entityType: "AppSetting",
    entityId: KEY,
    detail: {
      enabled: cfg.enabled, runAt: cfg.runAt, timezone: cfg.timezone,
      autoDiscover: cfg.autoDiscover, autoRunSources: cfg.autoRunSources,
      autoRescore: cfg.autoRescore, retentionCleanup: cfg.retentionCleanup,
    },
  });
}

// ---------------- Runtime in-process (singleton theo globalThis) ----------------

type SchedulerRuntime = {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  lastResult: { trigger: "scheduled" | "manual"; steps: string[]; finishedAt: string } | null;
  lastError: string | null;
  startedAt: string | null;
};

const g = globalThis as typeof globalThis & { __ts24SchedulerRuntime?: SchedulerRuntime };

function runtime(): SchedulerRuntime {
  if (!g.__ts24SchedulerRuntime) {
    g.__ts24SchedulerRuntime = { timer: null, running: false, lastResult: null, lastError: null, startedAt: null };
  }
  return g.__ts24SchedulerRuntime;
}

export async function getSchedulerStatus() {
  const cfg = await getSchedulerConfig();
  const rt = runtime();
  const nextRunAt = cfg.enabled ? computeNextRunAt(new Date(), cfg)?.toISOString() ?? null : null;
  return {
    config: cfg,
    running: isPipelineBusy(),
    lastResult: rt.lastResult,
    lastError: rt.lastError,
    nextRunAt,
    startedAt: rt.startedAt,
  };
}

export type PipelineRunResult = {
  ok: boolean;
  steps: string[];
  finishedAt: string;
  message?: string;
};

export type PipelineTrigger = "scheduled" | "manual" | "continuous";

export type PipelineSteps = {
  autoDiscover: boolean;
  autoRunSources: boolean;
  autoRescore: boolean;
  retentionCleanup: boolean;
};

// Mutex DÙNG CHUNG giữa scheduler theo lịch và continuous runner — bất kể nguồn gọi
// (thủ công / theo lịch / liên tục), cùng lúc chỉ được MỘT pipeline chạy để không
// chồng lấn job thu thập. Lưu trên globalThis để sống qua HMR.
const gBusy = globalThis as typeof globalThis & { __ts24PipelineBusy?: boolean };

export function isPipelineBusy(): boolean {
  return gBusy.__ts24PipelineBusy === true;
}

/**
 * Chạy trọn 4 bước pipeline với bộ bước tuỳ ý (scheduler theo lịch hoặc continuous runner).
 * Đang chạy thì bỏ qua (ok:false, message) — KHÔNG xếp hàng, tránh chồng lấn dữ liệu.
 */
export async function runPipelineSteps(stepsCfg: PipelineSteps, trigger: PipelineTrigger): Promise<PipelineRunResult> {
  if (isPipelineBusy()) {
    return { ok: false, steps: [], finishedAt: new Date().toISOString(), message: "Pipeline đang chạy — bỏ qua lần gọi này" };
  }
  gBusy.__ts24PipelineBusy = true;
  const steps: string[] = [];
  const actor = trigger === "continuous" ? "continuous-runner" : "scheduler";
  try {
    await audit({ actor, action: "scheduler.run_started", entityType: "Scheduler", detail: { trigger } });

    // 1) Dò nguồn mới (tuỳ chọn) — nguồn mới luôn chờ xem xét + tắt
    if (stepsCfg.autoDiscover) {
      const probed = await probeAndRegister({ fetchImpl: fetch });
      steps.push(`dò nguồn: ${probed.length} ứng viên, thêm mới ${probed.filter((p) => p.registered).length}`);
    }

    // 2) Chạy job cho các nguồn MẠNG đang bật (bỏ qua nguồn file/upload — không có gì để thu)
    if (stepsCfg.autoRunSources) {
      const networkTypes = ["COMPANY_WEBSITE", "PUBLIC_DIRECTORY", "OFFICIAL_API", "OFFICIAL_REGISTRY"];
      const sources = await db.source.findMany({
        where: { isActive: true, type: { in: networkTypes } },
        select: { id: true, name: true },
      });
      const config = await getScoringConfig();
      let okJobs = 0;
      let failJobs = 0;
      for (const s of sources) {
        const job = await db.collectionJob.create({ data: { sourceId: s.id, status: "PENDING" } });
        const res = await runCollectionJob(job.id, config);
        if (res.status === "COMPLETED") okJobs++;
        else failJobs++;
      }
      steps.push(`job thu thập: ${okJobs} hoàn tất, ${failJobs} lỗi (trên ${sources.length} nguồn mạng đang bật)`);
    }

    // 3) Chấm điểm lại toàn bộ lead
    if (stepsCfg.autoRescore) {
      const companies = await db.company.findMany({ select: { id: true } });
      const config = await getScoringConfig();
      await rescoreCompanies(companies.map((c) => c.id), config);
      steps.push(`chấm điểm lại: ${companies.length} lead`);
    }

    // 4) Dọn bản ghi quá hạn lưu giữ (retentionDays theo từng nguồn)
    if (stepsCfg.retentionCleanup) {
      const sources = await db.source.findMany({ select: { id: true, retentionDays: true } });
      let deleted = 0;
      for (const s of sources) {
        const cutoff = new Date(Date.now() - s.retentionDays * 86400000);
        const r = await db.sourceRecord.deleteMany({ where: { sourceId: s.id, collectedAt: { lt: cutoff } } });
        deleted += r.count;
      }
      steps.push(`dọn dữ liệu quá hạn lưu giữ: ${deleted} bản ghi`);
    }

    await audit({ actor, action: "scheduler.run_finished", entityType: "Scheduler", detail: { trigger, steps } });
    return { ok: true, steps, finishedAt: new Date().toISOString() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit({ actor, action: "scheduler.run_failed", entityType: "Scheduler", detail: { trigger, error: message } });
    return { ok: false, steps, finishedAt: new Date().toISOString(), message };
  } finally {
    gBusy.__ts24PipelineBusy = false;
  }
}

/** Chạy pipeline theo cấu hình scheduler hằng ngày (dùng cho lịch + nút chạy thử). */
export async function runScheduledPipeline(trigger: "scheduled" | "manual"): Promise<PipelineRunResult> {
  const rt = runtime();
  const cfg = await getSchedulerConfig();
  const r = await runPipelineSteps(cfg, trigger);
  if (r.ok) {
    const now = new Date();
    await saveSchedulerConfig(
      { ...cfg, lastRunAt: now.toISOString(), lastRunDay: dayStringInTz(now, cfg.timezone) },
      "scheduler"
    );
    rt.lastResult = { trigger, steps: r.steps, finishedAt: r.finishedAt };
    rt.lastError = null;
  } else if (r.message && !r.message.includes("đang chạy")) {
    rt.lastError = r.message;
  }
  return r;
}

/** Tick mỗi phút — bắn pipeline khi tới giờ cấu hình */
async function tick(): Promise<void> {
  const rt = runtime();
  if (rt.running) return;
  try {
    const cfg = await getSchedulerConfig();
    if (!shouldFireNow(new Date(), cfg)) return;
    await runScheduledPipeline("scheduled");
  } catch {
    // lỗi đọc cấu hình — bỏ qua tick này, không làm crash server
  }
}

/** Khởi động scheduler trong tiến trình server — gọi 1 lần từ instrumentation */
export function startScheduler(): void {
  const rt = runtime();
  if (rt.timer) return;
  rt.timer = setInterval(() => { void tick(); }, 60_000);
  rt.startedAt = new Date().toISOString();
  console.log("[scheduler] đã khởi động — tick mỗi 60s, cấu hình giờ chạy xem tại /api/scheduler");
}
