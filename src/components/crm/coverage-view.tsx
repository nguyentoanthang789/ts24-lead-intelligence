"use client";
// Trang 4 — Coverage Dashboard: độ bao phủ theo nguồn/tỉnh/ngành/sản phẩm + khoảng trống
// Hiển thị rõ: số liệu thực tế vs ước tính vs "Chưa xác định mẫu số bao phủ"
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AlertTriangle, Info, XOctagon } from "lucide-react";
import { api, PRODUCT_NAMES } from "@/lib/crm-api";

type CoverageRow = {
  dimension: string; key: string; discovered: number; afterDedup: number; validData: number;
  verified: number; productFit: Record<string, number>; requiredFieldRate: number;
  duplicateRate: number; errorRate: number; unverifiedRate: number; lastCollectedAt: string | null;
  denominator: number | null; denominatorSource: string | null; coveragePercent: number | null;
  coverageStatus: string;
};

type Report = {
  generatedAt: string;
  overall: {
    companies: number; validData: number; verified: number; highPriority: number; needsVerification: number;
    sourceRecords: number; duplicateRecords: number; errorRecords: number; needsReviewRecords: number;
    requiredFieldRate: number; duplicateRate: number; errorRate: number; unverifiedRate: number;
    coverageStatus: string; coveragePercent: number | null;
  };
  bySource: CoverageRow[]; byProvince: CoverageRow[]; bySector: CoverageRow[];
  byProduct: { productCode: string; productName: string; fitCount: number; avgFitScore: number; minFitThreshold: number }[];
  sourceHealth: { sourceId: string; name: string; type: string; isActive: boolean; accessPolicy: string; lastRunAt: string | null; status: string; errorJobs: number; totalJobs: number }[];
  gaps: { type: string; severity: string; message: string; suggestion: string }[];
  segments: { id: string; name: string; province: string | null; sector: string | null; estimatedTotal: number | null; denominatorSource: string | null; documented: boolean; matchedCompanies: number; coveragePercent: number | null; coverageStatus: string }[];
  marketCoverageNote: string;
};

export function CoverageView() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Report>("/api/coverage").then(setReport).catch((e) => setError((e as Error).message));
  }, []);

  if (error) return <Alert variant="destructive"><AlertTitle>Lỗi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!report) return <div className="grid gap-4 md:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-28" />)}</div>;

  const o = report.overall;
  const cards = [
    { label: "Doanh nghiệp sau khử trùng lặp", value: o.companies },
    { label: "Có dữ liệu hợp lệ", value: `${o.validData} (${o.requiredFieldRate}%)` },
    { label: "Đã xác minh", value: `${o.verified}` },
    { label: "Tỷ lệ trùng / lỗi", value: `${o.duplicateRate}% / ${o.errorRate}%` },
    { label: "Chưa xác minh", value: `${o.unverifiedRate}%` },
    { label: "Bản ghi chờ xem xét", value: o.needsReviewRecords },
  ];

  const chartData = report.byProvince.filter((r) => r.key !== "(Chưa xác định)").slice(0, 10).map((r) => ({
    name: r.key.length > 14 ? r.key.slice(0, 13) + "…" : r.key,
    lead: r.afterDedup,
  }));

  return (
    <div className="space-y-5">
      <Alert>
        <AlertTitle>Bao phủ thị trường: {o.coveragePercent !== null ? `${o.coveragePercent}%` : "Chưa xác định mẫu số bao phủ"}</AlertTitle>
        <AlertDescription>{report.marketCoverageNote}</AlertDescription>
      </Alert>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{c.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{c.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lead theo địa phương (dữ liệu thực tế trong hệ thống)</CardTitle></CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="lead" fill="#059669" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Biểu đồ phản ánh số lead đang có trong CSDL — KHÔNG phải tỷ lệ thị trường.</p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="province">
        <TabsList>
          <TabsTrigger value="province">Theo tỉnh/thành</TabsTrigger>
          <TabsTrigger value="sector">Theo ngành</TabsTrigger>
          <TabsTrigger value="source">Theo nguồn</TabsTrigger>
          <TabsTrigger value="product">Theo sản phẩm</TabsTrigger>
          <TabsTrigger value="segments">Phân khúc có mẫu số</TabsTrigger>
        </TabsList>
        <TabsContent value="province">
          <CoverageTable rows={report.byProvince} labelKey="Tỉnh/thành" />
        </TabsContent>
        <TabsContent value="sector">
          <CoverageTable rows={report.bySector} labelKey="Ngành" />
        </TabsContent>
        <TabsContent value="source">
          <CoverageTable rows={report.bySource} labelKey="Nguồn" />
        </TabsContent>
        <TabsContent value="product">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sản phẩm</TableHead><TableHead className="text-right">Lead phù hợp</TableHead>
                <TableHead className="text-right">Điểm fit TB</TableHead><TableHead className="text-right">Ngưỡng fit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.byProduct.map((p) => (
                <TableRow key={p.productCode}>
                  <TableCell className="font-medium">{p.productCode} — {PRODUCT_NAMES[p.productCode] ?? p.productName}</TableCell>
                  <TableCell className="text-right font-semibold">{p.fitCount}</TableCell>
                  <TableCell className="text-right">{p.avgFitScore || "—"}</TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">≥ {p.minFitThreshold}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="segments">
          {report.segments.length === 0 ? <p className="p-4 text-sm text-muted-foreground">Chưa khai báo phân khúc nào.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Phân khúc</TableHead>
                  <TableHead>Mẫu số</TableHead>
                  <TableHead>Nguồn mẫu số</TableHead>
                  <TableHead className="text-right">Lead trong hệ thống</TableHead>
                  <TableHead className="text-right">Bao phủ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.segments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>{s.estimatedTotal ?? "—"}</TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate">{s.denominatorSource ?? "—"}</TableCell>
                    <TableCell className="text-right">{s.matchedCompanies}</TableCell>
                    <TableCell className="text-right">
                      {s.coveragePercent !== null
                        ? <Badge className="bg-emerald-100 text-emerald-800">{s.coveragePercent}%</Badge>
                        : <Badge variant="outline">Chưa xác định mẫu số bao phủ</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Phát hiện khoảng trống &amp; đề xuất hành động</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0 space-y-2">
          {report.gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa phát hiện khoảng trống đáng kể từ dữ liệu hiện có. Hệ thống không khẳng định đã tìm được tất cả doanh nghiệp trên thị trường.</p>
          ) : report.gaps.map((g, i) => (
            <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
              {g.severity === "CRITICAL" ? <XOctagon className="h-5 w-5 text-red-600 shrink-0" />
                : g.severity === "WARNING" ? <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                : <Info className="h-5 w-5 text-stone-500 shrink-0" />}
              <div>
                <div className="text-sm font-medium">{g.message}</div>
                <div className="text-xs text-muted-foreground">Đề xuất: {g.suggestion}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CoverageTable({ rows, labelKey }: { rows: CoverageRow[]; labelKey: string }) {
  if (rows.length === 0) return <p className="p-4 text-sm text-muted-foreground">Chưa có dữ liệu theo chiều này.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{labelKey}</TableHead>
          <TableHead className="text-right">Bản ghi</TableHead>
          <TableHead className="text-right">Sau khử trùng lặp</TableHead>
          <TableHead className="text-right">Hợp lệ</TableHead>
          <TableHead className="text-right">Đã xác minh</TableHead>
          <TableHead className="text-right">Trùng</TableHead>
          <TableHead className="text-right">Lỗi</TableHead>
          <TableHead>Bao phủ thị trường</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell className="font-medium max-w-[200px] truncate">{r.key}</TableCell>
            <TableCell className="text-right">{r.discovered}</TableCell>
            <TableCell className="text-right font-semibold">{r.afterDedup}</TableCell>
            <TableCell className="text-right">{r.validData}</TableCell>
            <TableCell className="text-right">{r.verified}</TableCell>
            <TableCell className="text-right text-xs">{r.duplicateRate}%</TableCell>
            <TableCell className="text-right text-xs">{r.errorRate}%</TableCell>
            <TableCell>
              {r.coveragePercent !== null ? (
                <span title={r.denominatorSource ?? ""}>
                  <Badge className="bg-emerald-100 text-emerald-800">{r.coveragePercent}%</Badge>
                  <span className="ml-1 text-xs text-muted-foreground">(mẫu số {r.denominator})</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">Chưa xác định mẫu số bao phủ</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
