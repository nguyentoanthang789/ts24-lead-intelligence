"use client";
// Nút START — chạy toàn bộ pipeline LIÊN TỤC KHÔNG NGHỈ:
// dò nguồn → thu thập nguồn đang bật → chấm điểm lại lead → dọn dữ liệu quá hạn,
// rồi lặp lại mãi mãi (nghỉ `intervalMinutes` phút giữa các vòng) cho tới khi bấm STOP.
// Dùng ở cả Overview (nút to nổi bật) và Cài đặt → Tự động chạy.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Loader2, Infinity as InfinityIcon, Save, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate } from "@/lib/crm-api";

type ContinuousStatus = {
  config: {
    running: boolean; intervalMinutes: number;
    autoDiscover: boolean; autoRunSources: boolean; autoImportInbox: boolean; autoRescore: boolean; retentionCleanup: boolean;
  };
  active: boolean;
  cycleCount: number;
  failCount: number;
  startedAt: string | null;
  startedBy: string | null;
  runningCycle: boolean;
  currentCycleStartedAt: string | null;
  lastCycleAt: string | null;
  lastCycleResult: { steps: string[]; ok: boolean; skipped?: boolean } | null;
  lastError: string | null;
  nextCycleAt: string | null;
  uptimeMinutes: number;
};

export function ContinuousRunnerCard() {
  const [st, setSt] = useState<ContinuousStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [intervalMin, setIntervalMin] = useState("10");
  const [cycleTick, setCycleTick] = useState(0); // để render lại thời gian vòng đang chạy

  const load = useCallback(async () => {
    const s = await api<ContinuousStatus>("/api/continuous");
    setSt(s);
    setIntervalMin(String(s.config.intervalMinutes));
  }, []);

  useEffect(() => {
    load().catch(() => {}); // im lặng — card lỗi không chặn trang
    const t = setInterval(() => { load().catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    // nhịp render lại "đã chạy được mm:ss" của vòng hiện tại
    const t = setInterval(() => setCycleTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function toggle(action: "start" | "stop") {
    setBusy(true);
    try {
      const r = await api<{ status: ContinuousStatus; result: { started?: boolean; stopped?: boolean; message?: string } }>(
        "/api/continuous",
        { method: "POST", body: JSON.stringify({ action }) }
      );
      setSt(r.status);
      setIntervalMin(String(r.status.config.intervalMinutes));
      if (r.result.message) toast.info(r.result.message);
      else if (action === "start") toast.success("ĐÃ BẮT ĐẦU chạy liên tục — vòng đầu tiên đang chạy");
      else toast.success("Đã dừng chế độ chạy liên tục");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveInterval() {
    const n = parseInt(intervalMin, 10);
    if (!Number.isFinite(n) || n < 0 || n > 720) {
      toast.error("Thời gian nghỉ phải là số nguyên từ 0 đến 720 phút (0 = không nghỉ)");
      return;
    }
    setBusy(true);
    try {
      const s = await api<ContinuousStatus>("/api/continuous", {
        method: "PUT",
        body: JSON.stringify({ intervalMinutes: n }),
      });
      setSt(s);
      toast.success("Đã lưu — áp dụng từ vòng kế tiếp");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!st) return <Skeleton className="h-40" />;

  const isActive = st.active || st.runningCycle;
  const cycleSeconds = st.currentCycleStartedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(st.currentCycleStartedAt)) / 1000))
    : 0;
  const cycleElapsed = `${Math.floor(cycleSeconds / 60)}p${String(cycleSeconds % 60).padStart(2, "0")}s`;

  return (
    <Card data-cycle-tick={cycleTick} className={isActive ? "border-emerald-300" : ""}>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <InfinityIcon className="h-4 w-4" aria-hidden /> Chạy toàn bộ liên tục
          {isActive && <Badge className="bg-emerald-600">ĐANG CHẠY</Badge>}
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {st.startedAt ? `Bật lúc ${fmtDate(st.startedAt)} · ${st.uptimeMinutes} phút` : "Chưa bật"}
        </span>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {!isActive ? (
            <Button
              size="lg"
              className="h-12 px-6 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => toggle("start")}
              disabled={busy}
              aria-label="START chạy toàn bộ liên tục"
            >
              <Play className="h-5 w-5 mr-2" aria-hidden /> START — Chạy toàn bộ, liên tục không nghỉ
            </Button>
          ) : (
            <Button
              size="lg"
              variant="destructive"
              className="h-12 px-6 text-base font-bold"
              onClick={() => toggle("stop")}
              disabled={busy}
              aria-label="STOP dừng chạy liên tục"
            >
              <Square className="h-5 w-5 mr-2" aria-hidden /> STOP — Dừng lại
            </Button>
          )}
          {st.runningCycle && (
            <span className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Đang chạy vòng #{st.cycleCount + 1}… ({cycleElapsed})
            </span>
          )}
          {isActive && !st.runningCycle && (
            <span className="text-sm text-muted-foreground">Vòng tới: <b>{fmtDate(st.nextCycleAt)}</b></span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Mỗi vòng chạy đầy đủ: dò nguồn mới → thu thập các nguồn mạng đang bật → <b>nhập tự động hộp thư inbox</b> → chấm điểm lại lead → dọn dữ liệu quá hạn.
          {st.config.intervalMinutes === 0
            ? <> Hết vòng <b>chạy vòng mới NGAY</b> (không nghỉ — chỉ chốt 5 giây) — hoạt động 24/7 cho tới khi bấm STOP; server khởi động lại cũng tự chạy tiếp.</>
            : <> Hết vòng nghỉ <b>{st.config.intervalMinutes}</b> phút rồi chạy tiếp — hoạt động 24/7 cho tới khi bấm STOP (server khởi động lại cũng tự chạy tiếp).</>}
          {" "}Vẫn tôn trọng robots.txt &amp; hạn tốc độ của từng nguồn; <b>không tự gửi tin nhắn Zalo</b>.
        </p>
        <Alert>
          <AlertTitle className="text-sm">Vì sao lead chưa chảy ra — 2 kênh để bot tự tạo lead</AlertTitle>
          <AlertDescription className="text-xs space-y-1">
            <p><b>Kênh 1 — Nguồn mạng:</b> vào <b>Nguồn dữ liệu</b> duyệt + bật nguồn đã được phép. Phần lớn danh bạ VN chủ động chặn bot (HTTP 403) và hệ thống <b>không né cơ chế chống bot</b> — chỉ bật được nguồn nào cho phép truy cập.</p>
            <p><b>Kênh 2 — Hộp thư inbox (luôn chạy):</b> thả tệp CSV/XLSX doanh nghiệp vào thư mục <code className="font-mono">upload/inbox/</code> — bot tự nhập ở vòng kế tiếp: chuẩn hóa → khử trùng lặp → chấm điểm → lead xuất hiện ở Lead Explorer. Tệp đã nhập chuyển sang <code className="font-mono">processed/</code>, tệp lỗi sang <code className="font-mono">failed/</code>.</p>
          </AlertDescription>
        </Alert>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold text-emerald-700">{st.cycleCount}</div>
            <div className="text-xs text-muted-foreground">Vòng đã hoàn tất</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-2xl font-bold">{st.config.intervalMinutes === 0 ? "0 (không nghỉ)" : st.config.intervalMinutes}</div>
            <div className="text-xs text-muted-foreground">Phút nghỉ giữa các vòng</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className={`text-2xl font-bold ${st.failCount > 0 ? "text-red-600" : ""}`}>{st.failCount}</div>
            <div className="text-xs text-muted-foreground">Vòng lỗi liên tiếp (hệ thống vẫn chạy tiếp)</div>
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-sm">Nghỉ giữa các vòng (phút, 0 = không nghỉ, tối đa 720)</Label>
            <Input
              type="number" min={0} max={720}
              value={intervalMin}
              onChange={(e) => setIntervalMin(e.target.value)}
              className="w-28" aria-label="Phút nghỉ giữa các vòng, 0 là không nghỉ"
            />
          </div>
          <Button variant="outline" onClick={saveInterval} disabled={busy}>
            <Save className="h-4 w-4 mr-1" /> Lưu
          </Button>
        </div>

        {st.lastCycleResult && !st.lastCycleResult.skipped && st.lastCycleResult.steps.length > 0 && (
          <div>
            <div className="text-sm font-medium">Kết quả vòng #{st.cycleCount} ({fmtDate(st.lastCycleAt)})</div>
            <ul className="list-disc pl-5 text-sm space-y-0.5 mt-1">
              {st.lastCycleResult.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
        {st.lastCycleResult?.skipped && (
          <Alert>
            <AlertTitle className="text-sm">Vòng gần nhất bị nhường</AlertTitle>
            <AlertDescription className="text-xs">
              Pipeline khác (thủ công/theo lịch) đang chạy nên vòng này bỏ qua — hệ thống tự thử lại ở vòng kế tiếp.
            </AlertDescription>
          </Alert>
        )}
        {st.lastError && (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle className="text-sm">Lỗi vòng gần nhất (vẫn chạy tiếp vòng sau)</AlertTitle>
            <AlertDescription className="text-xs">{st.lastError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
