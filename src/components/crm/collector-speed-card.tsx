"use client";
// Card cấu hình TỐC ĐỘ thu thập: đi sâu tối đa bao nhiêu trang mỗi nguồn,
// chạy song song bao nhiêu nguồn — nhân tốc độ tạo lead thật mỗi vòng.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Gauge, Save } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/crm-api";

type CollectorConfig = {
  maxPagesPerSource: number;
  sourceConcurrency: number;
  requestTimeoutMs: number;
};

export function CollectorSpeedCard() {
  const [cfg, setCfg] = useState<CollectorConfig | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ config: CollectorConfig }>("/api/collector");
    setCfg(r.config);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  async function save() {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await api<{ saved: boolean; errors: string[]; config: CollectorConfig }>("/api/collector", {
        method: "PUT",
        body: JSON.stringify({
          maxPagesPerSource: cfg.maxPagesPerSource,
          sourceConcurrency: cfg.sourceConcurrency,
          requestTimeoutMs: cfg.requestTimeoutMs,
        }),
      });
      if (r.saved) {
        setCfg(r.config);
        toast.success("Đã lưu tốc độ thu thập — vòng kế tiếp áp dụng ngay");
      } else {
        toast.error(r.errors.join("; "));
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" /> Tốc độ thu thập (cào tối đa)</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        {!cfg ? <Skeleton className="h-24" /> : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Số trang đi sâu mỗi nguồn (1–1000)</Label>
                <Input type="number" min={1} max={1000} value={cfg.maxPagesPerSource}
                  onChange={(e) => setCfg({ ...cfg, maxPagesPerSource: parseInt(e.target.value || "1", 10) })} />
                <p className="text-[11px] text-muted-foreground">Mỗi trang lấy được cả chục lead → nhân số lead/vòng</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Số nguồn chạy song song (1–8)</Label>
                <Input type="number" min={1} max={8} value={cfg.sourceConcurrency}
                  onChange={(e) => setCfg({ ...cfg, sourceConcurrency: parseInt(e.target.value || "1", 10) })} />
                <p className="text-[11px] text-muted-foreground">Nhiều nguồn cùng cào cùng lúc, mỗi nguồn vẫn giữ nhịp riêng</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Timeout mỗi request (ms)</Label>
                <Input type="number" min={5000} max={60000} step={1000} value={cfg.requestTimeoutMs}
                  onChange={(e) => setCfg({ ...cfg, requestTimeoutMs: parseInt(e.target.value || "15000", 10) })} />
                <p className="text-[11px] text-muted-foreground">5000–60000ms — nguồn chậm thì tăng</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Tốc độ cào bị chặn tự nhiên bởi giới hạn của từng nguồn (robots.txt + rate limit nguồn tự khai báo) —
              hệ thống KHÔNG né chống bot. Muốn nhanh hơn: bật nhiều nguồn đã duyệt + tăng số trang/số nguồn song song.
            </p>
            <Button onClick={save} disabled={busy}><Save className="h-4 w-4 mr-1" /> Lưu tốc độ</Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
