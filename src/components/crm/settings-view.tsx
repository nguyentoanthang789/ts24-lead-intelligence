"use client";
// Trang 6 — Settings & Audit: cấu hình chấm điểm, mẫu tin nhắn, danh sách loại trừ, audit log
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Database, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate, PRODUCT_NAMES } from "@/lib/crm-api";

type Settings = {
  config: {
    version: number;
    weights: { productFit: number; evidence: number; segment: number; contact: number; freshness: number };
    tierThresholds: { high: number; needsVerification: number; low: number };
    freshnessDays: number;
    keyProvinces: string[];
  };
  products: { code: string; name: string; isActive: boolean }[];
  senderName: string;
};

type TemplateRow = { id: string; name: string; productCode: string | null; body: string; isActive: boolean };
type SupRow = { id: string; value: string; scope: string; reason: string | null; createdAt: string };
type AuditRow = { id: string; actor: string; action: string; entityType: string; entityId: string | null; detail: string | null; createdAt: string };

export function SettingsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [weights, setWeights] = useState<Settings["config"]["weights"] | null>(null);
  const [thresholds, setThresholds] = useState<Settings["config"]["tierThresholds"] | null>(null);
  const [senderName, setSenderName] = useState("");
  const [auditRows, setAuditRows] = useState<AuditRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await api<Settings>("/api/settings");
    setSettings(s);
    setWeights(s.config.weights);
    setThresholds(s.config.tierThresholds);
    setSenderName(s.senderName);
    const a = await api<{ items: AuditRow[] }>("/api/audit?pageSize=30");
    setAuditRows(a.items);
  }, []);

  useEffect(() => {
    load().catch((e) => toast.error((e as Error).message));
  }, [load]);

  async function saveConfig() {
    if (!weights || !thresholds) return;
    setBusy(true);
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          weights, tierThresholds: thresholds,
          freshnessDays: settings?.config.freshnessDays ?? 90,
          keyProvinces: settings?.config.keyProvinces ?? [],
          senderName,
        }),
      });
      toast.success("Đã lưu cấu hình (tăng phiên bản quy tắc)");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rescoreAll() {
    setBusy(true);
    try {
      const r = await api<{ scored: number; ruleVersion: string }>("/api/score", { method: "POST", body: JSON.stringify({}) });
      toast.success(`Đã chấm điểm lại ${r.scored} lead (${r.ruleVersion})`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function seedDemo() {
    setBusy(true);
    try {
      await api("/api/admin/seed", { method: "POST", body: JSON.stringify({}) });
      toast.success("Đã nạp dữ liệu demo tổng hợp");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const weightSum = weights ? Object.values(weights).reduce((a, b) => a + b, 0) : 0;

  return (
    <Tabs defaultValue="scoring">
      <TabsList className="flex flex-wrap h-auto">
        <TabsTrigger value="scoring">Chấm điểm</TabsTrigger>
        <TabsTrigger value="templates">Mẫu tin nhắn</TabsTrigger>
        <TabsTrigger value="suppression">Danh sách loại trừ</TabsTrigger>
        <TabsTrigger value="audit">Audit log</TabsTrigger>
      </TabsList>

      <TabsContent value="scoring" className="space-y-4">
        {!weights || !thresholds ? <Skeleton className="h-64" /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Trọng số thang điểm (tổng = 100)</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {(Object.keys(weights) as (keyof typeof weights)[]).map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <Label className="w-44 text-sm">{WEIGHT_LABELS[k]}</Label>
                    <Input type="number" min={0} max={100} value={weights[k]}
                      onChange={(e) => setWeights({ ...weights, [k]: parseInt(e.target.value || "0", 10) })} className="w-24" />
                  </div>
                ))}
                <p className={`text-xs ${weightSum === 100 ? "text-emerald-600" : "text-red-600"}`}>
                  Tổng hiện tại: {weightSum} {weightSum !== 100 && "— phải đúng 100 mới lưu được"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Ngưỡng phân hạng &amp; thông tin gửi</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0 space-y-2">
                {(["high", "needsVerification", "low"] as const).map((k) => (
                  <div key={k} className="flex items-center gap-3">
                    <Label className="w-44 text-sm">{THRESHOLD_LABELS[k]}</Label>
                    <Input type="number" min={0} max={100} value={thresholds[k]}
                      onChange={(e) => setThresholds({ ...thresholds, [k]: parseInt(e.target.value || "0", 10) })} className="w-24" />
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <Label className="w-44 text-sm">Tên người gửi (dùng trong template)</Label>
                  <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} className="w-44" placeholder="VD: Nguyễn Văn A" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveConfig} disabled={busy || weightSum !== 100}>Lưu cấu hình</Button>
          <Button variant="outline" onClick={rescoreAll} disabled={busy}><RefreshCw className="h-4 w-4 mr-1" /> Chạy lại chấm điểm</Button>
          <Button variant="outline" onClick={seedDemo} disabled={busy}><Database className="h-4 w-4 mr-1" /> Nạp dữ liệu demo</Button>
        </div>
        {settings && (
          <Alert>
            <AlertTitle className="text-sm">Sản phẩm đang quản lý</AlertTitle>
            <AlertDescription className="text-xs">
              {settings.products.map((p) => `${p.code} — ${PRODUCT_NAMES[p.code] ?? p.name}`).join(" · ")}
            </AlertDescription>
          </Alert>
        )}
      </TabsContent>

      <TabsContent value="templates">
        <TemplatesPanel />
      </TabsContent>

      <TabsContent value="suppression">
        <SuppressionPanel />
      </TabsContent>

      <TabsContent value="audit">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Lịch sử thao tác quan trọng (đã sanitize)</CardTitle></CardHeader>
          <CardContent className="p-0">
            {!auditRows ? <div className="p-4"><Skeleton className="h-40" /></div> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Thời gian</TableHead><TableHead>Người thao tác</TableHead><TableHead>Hành động</TableHead><TableHead>Đối tượng</TableHead><TableHead>Chi tiết</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {auditRows.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{fmtDate(a.createdAt)}</TableCell>
                      <TableCell className="text-xs">{a.actor}</TableCell>
                      <TableCell className="font-mono text-xs">{a.action}</TableCell>
                      <TableCell className="text-xs">{a.entityType}{a.entityId ? ` · ${a.entityId.slice(0, 8)}…` : ""}</TableCell>
                      <TableCell className="text-xs max-w-[280px] truncate">{a.detail ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

const WEIGHT_LABELS: Record<string, string> = {
  productFit: "Phù hợp sản phẩm (0-30)",
  evidence: "Bằng chứng nhu cầu (0-25)",
  segment: "Phân khúc (0-20)",
  contact: "Khả năng liên hệ (0-15)",
  freshness: "Độ mới dữ liệu (0-10)",
};
const THRESHOLD_LABELS: Record<string, string> = {
  high: "Ngưỡng ưu tiên cao ≥",
  needsVerification: "Ngưỡng cần xác minh ≥",
  low: "Ngưỡng ưu tiên thấp ≥",
};

function TemplatesPanel() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", productCode: "", body: "" });
  const [editing, setEditing] = useState<TemplateRow | null>(null);

  const load = useCallback(async () => {
    setRows(await api<TemplateRow[]>("/api/templates"));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, setState diễn ra sau await
    load().catch((e) => toast.error((e as Error).message));
  }, [load]);

  async function save() {
    try {
      if (editing) {
        await api(`/api/templates/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: form.name, body: form.body, productCode: form.productCode || null }) });
      } else {
        await api("/api/templates", { method: "POST", body: JSON.stringify({ name: form.name, body: form.body, productCode: form.productCode || undefined }) });
      }
      toast.success("Đã lưu mẫu");
      setOpen(false); setEditing(null);
      setForm({ name: "", productCode: "", body: "" });
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/templates/${id}`, { method: "DELETE" });
      toast.success("Đã xóa mẫu");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base">Mẫu nội dung theo sản phẩm — biến: {"{company_name} {business_sector} {product_name} {verified_business_context} {sender_name}"}</CardTitle>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Thêm mẫu</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{editing ? "Sửa mẫu" : "Mẫu mới"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Tên mẫu *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Sản phẩm (tuỳ chọn)</Label>
                <Input value={form.productCode} onChange={(e) => setForm({ ...form, productCode: e.target.value.toUpperCase().slice(0, 1) })} placeholder="A..F hoặc để trống" />
              </div>
              <div><Label>Nội dung * (biến thiếu sẽ bị bỏ qua, không tự điền)</Label>
                <Textarea rows={7} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
            </div>
            <DialogFooter><Button onClick={save} disabled={form.name.length < 2 || form.body.length < 10}>Lưu</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-2">
        {!rows ? <Skeleton className="h-24" /> : rows.map((t) => (
          <div key={t.id} className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium text-sm">{t.name} {t.productCode && <span className="text-xs text-muted-foreground">({t.productCode})</span>}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => { setEditing(t); setForm({ name: t.name, productCode: t.productCode ?? "", body: t.body }); setOpen(true); }}>Sửa</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <pre className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground max-h-24 overflow-y-auto">{t.body}</pre>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SuppressionPanel() {
  const [rows, setRows] = useState<SupRow[] | null>(null);
  const [value, setValue] = useState("");

  const load = useCallback(async () => {
    setRows(await api<SupRow[]>("/api/suppression"));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, setState diễn ra sau await
    load().catch((e) => toast.error((e as Error).message));
  }, [load]);

  async function add() {
    try {
      await api("/api/suppression", { method: "POST", body: JSON.stringify({ value, reason: "Thêm thủ công từ Settings" }) });
      toast.success("Đã thêm vào danh sách loại trừ");
      setValue("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function remove(id: string) {
    try {
      await api("/api/suppression", { method: "DELETE", body: JSON.stringify({ id }) });
      toast.success("Đã gỡ khỏi danh sách");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Danh sách không tiếp tục liên hệ (lead bị loại trừ không thể vào hàng đợi)</CardTitle></CardHeader>
      <CardContent className="p-4 pt-0 space-y-3">
        <div className="flex gap-2">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="MST / SĐT / email / domain" />
          <Button onClick={add} disabled={value.length < 3}><Plus className="h-4 w-4 mr-1" /> Thêm</Button>
        </div>
        {!rows ? <Skeleton className="h-24" /> : rows.length === 0 ? <p className="text-sm text-muted-foreground">Danh sách trống.</p> : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Giá trị</TableHead><TableHead>Phạm vi</TableHead><TableHead>Lý do</TableHead><TableHead>Thêm lúc</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.value}</TableCell>
                  <TableCell className="text-xs">{r.scope}</TableCell>
                  <TableCell className="text-xs">{r.reason ?? "—"}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.createdAt)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
