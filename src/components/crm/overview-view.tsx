"use client";
// Trang 1 — Overview: tổng quan, thống kê sản phẩm, tình trạng nguồn, khoảng trống nổi bật
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building2, AlertTriangle, ClipboardList, ShieldCheck, Users } from "lucide-react";
import { api, fmtDate, PRODUCT_NAMES } from "@/lib/crm-api";
import { SourceStatusBadge } from "@/components/crm/badges";

type Overview = {
  hasData: boolean;
  totals: { companies: number; highPriority: number; needsVerification: number; low: number; notSuitable: number };
  outreachFunnel: Record<string, number>;
  productStats: { code: string; name: string; description: string | null; fitCount: number; avgFitScore: number }[];
  sources: { id: string; name: string; type: string; isActive: boolean; lastRunAt: string | null; status: string }[];
  sourcesNeedingReview: number;
  recentEvents: { id: string; type: string; occurredAt: string; note: string | null; companyName: string }[];
  records: { total: number; valid: number; duplicate: number; error: number; needsReview: number };
};

export function OverviewView({ onGoTo }: { onGoTo: (view: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>("/api/overview").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <Alert variant="destructive"><AlertTitle>Lỗi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!data) return <div className="grid gap-4 md:grid-cols-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  const stats = [
    { label: "Doanh nghiệp đã phát hiện", value: data.totals.companies, icon: Building2, cls: "text-emerald-600" },
    { label: "Lead ưu tiên cao", value: data.totals.highPriority, icon: Users, cls: "text-teal-600" },
    { label: "Cần xác minh thêm", value: data.totals.needsVerification, icon: AlertTriangle, cls: "text-amber-600" },
    { label: "Bản ghi trong nguồn", value: data.records.total, icon: ClipboardList, cls: "text-stone-600" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="p-6 flex items-center gap-4">
              <s.icon className={`h-8 w-8 ${s.cls}`} aria-hidden />
              <div>
                <div className="text-3xl font-bold">{s.value}</div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.totals.companies === 0 && (
        <Alert>
          <AlertTitle>Chưa có dữ liệu nền</AlertTitle>
          <AlertDescription>
            Chưa hiển thị số liệu tổng hợp khi chưa có dữ liệu. Hãy vào <b>Lead Explorer</b> để nhập doanh nghiệp hoặc <b>Cài đặt</b> để nạp dữ liệu demo tổng hợp.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Thống kê theo từng sản phẩm TS24</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead className="text-right">Lead phù hợp</TableHead>
                  <TableHead className="text-right">Điểm fit TB</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.productStats.map((p) => (
                  <TableRow key={p.code}>
                    <TableCell>
                      <div className="font-medium">{p.code} — {PRODUCT_NAMES[p.code] ?? p.name}</div>
                    </TableCell>
                    <TableCell className="text-right font-semibold">{p.fitCount}</TableCell>
                    <TableCell className="text-right">{p.fitCount > 0 ? p.avgFitScore : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Tình trạng các nguồn dữ liệu</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            {data.sources.length === 0 && <p className="text-sm text-muted-foreground">Chưa có nguồn nào.</p>}
            {data.sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground">Chạy gần nhất: {fmtDate(s.lastRunAt)}</div>
                </div>
                <SourceStatusBadge status={s.status} isActive={s.isActive} />
              </div>
            ))}
            {data.sourcesNeedingReview > 0 && (
              <Alert className="mt-2">
                <AlertTitle className="text-sm">{data.sourcesNeedingReview} nguồn chờ xem xét quyền truy cập</AlertTitle>
                <AlertDescription className="text-xs">Hệ thống không bật thu thập cho nguồn chưa xác minh điều khoản sử dụng.</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Kết quả xử lý lead (phễu tiếp cận)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            {Object.keys(data.outreachFunnel).length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có lead nào.</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(data.outreachFunnel).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3">
                    <span className="w-44 text-sm">{k}</span>
                    <div className="flex-1 h-6 rounded bg-stone-100 overflow-hidden">
                      <div className="h-full bg-emerald-500/80" style={{ width: `${Math.min(100, (v / Math.max(1, data.totals.companies)) * 100)}%` }} />
                    </div>
                    <span className="w-8 text-right text-sm font-medium">{v}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Khoảng trống dữ liệu nổi bật</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
            <button onClick={() => onGoTo("coverage")} className="w-full text-left rounded-lg border p-3 hover:bg-stone-50 transition">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Xem đầy đủ trên Coverage Dashboard</span>
                <Badge variant="outline">Đi tới</Badge>
              </div>
            </button>
            {data.sources.some((s) => s.status !== "OK" && s.status !== "READY") === false && (
              <p className="text-sm text-muted-foreground">Chưa phát hiện khoảng trống nghiêm trọng từ số liệu hiện có.</p>
            )}
            {data.records.needsReview > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                {data.records.needsReview} bản ghi chờ xem xét hợp nhất thủ công — tránh bỏ sót doanh nghiệp trùng lặp.
              </div>
            )}
            {data.records.error > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                {data.records.error} bản ghi lỗi (thiếu trường/sai định dạng) — xem chi tiết ở Lead Explorer &gt; nguồn.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Sự kiện tương tác gần nhất (theo thao tác đã xác nhận)</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {data.recentEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Chưa có sự kiện nào — lịch sử chỉ ghi khi người dùng thao tác.</p>
          ) : (
            <div className="space-y-1.5">
              {data.recentEvents.map((e) => (
                <div key={e.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
                  <span><b>{e.companyName}</b> — {e.type}{e.note ? `: ${e.note}` : ""}</span>
                  <span className="text-xs text-muted-foreground">{fmtDate(e.occurredAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
