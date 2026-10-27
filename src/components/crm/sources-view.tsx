"use client";
// Trang 3 — Source Manager: quản lý nguồn, kiểm tra truy cập, lịch thu thập, điều khiển job
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Radar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Pause, Play, Plus, ShieldCheck, Square, RotateCcw } from "lucide-react"; // Radar import ở dòng trên
import { toast } from "sonner";
import { api, fmtDate, SOURCE_TYPE_LABELS } from "@/lib/crm-api";
import { SourceStatusBadge } from "@/components/crm/badges";

type Source = {
  id: string; name: string; type: string; url: string | null; allowedScope: string | null;
  accessPolicy: string; robotsStatus: string | null; robotsNote: string | null;
  rateLimitPerMin: number; dataRightsNote: string | null; retentionDays: number;
  isActive: boolean; needsReview: boolean; lastRunAt: string | null;
  _count: { sourceRecords: number; collectionJobs: number };
};

type Job = {
  id: string; status: string; discoveredCount: number; validCount: number; errorCount: number;
  duplicateCount: number; logText: string | null; createdAt: string; finishedAt: string | null;
  source: { name: string; type: string };
};

export function SourcesView() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSources(await api<Source[]>("/api/sources"));
      const j = await api<{ items: Job[] }>("/api/jobs?pageSize=15");
      setJobs(j.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount + poll 10s, setState diễn ra sau await
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function toggleActive(s: Source, next: boolean) {
    try {
      await api(`/api/sources/${s.id}`, { method: "PATCH", body: JSON.stringify({ isActive: next }) });
      toast.success(next ? "Đã bật nguồn" : "Đã tắt nguồn");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function checkSource(s: Source) {
    toast.info("Đang kiểm tra truy cập + robots.txt...");
    try {
      const r = await api<{ checked: boolean; message: string }>(`/api/sources/${s.id}/check`, { method: "POST" });
      toast.info(r.message);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function createJob(s: Source) {
    try {
      await api("/api/jobs", { method: "POST", body: JSON.stringify({ sourceId: s.id }) });
      toast.success("Đã tạo job thu thập");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function controlJob(job: Job, action: string) {
    try {
      await api(`/api/jobs/${job.id}`, { method: "POST", body: JSON.stringify({ action }) });
      toast.success(`Đã ${action}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <Alert>
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Nguyên tắc thu thập</AlertTitle>
        <AlertDescription>
          Nguồn mới luôn ở trạng thái <b>chờ xem xét</b> và <b>tắt</b> cho đến khi kiểm tra khả năng truy cập, robots.txt và quyền sử dụng dữ liệu.
          Hệ thống không thu thập khi nguồn từ chối, không vượt CAPTCHA/chống bot, và không tạo dữ liệu thay thế khi không lấy được.
        </AlertDescription>
      </Alert>

      <div className="flex justify-end gap-2">
        <DiscoveryDialog open={discoveryOpen} onOpenChange={setDiscoveryOpen} onDone={() => load()} />
        <AddSourceDialog open={addOpen} onOpenChange={setAddOpen} onDone={() => { setAddOpen(false); load(); }} />
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Lỗi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Danh mục nguồn (Source Registry)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!sources ? <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nguồn</TableHead>
                  <TableHead>Loại</TableHead>
                  <TableHead>Chính sách</TableHead>
                  <TableHead>robots</TableHead>
                  <TableHead>Bản ghi</TableHead>
                  <TableHead>Chạy gần nhất</TableHead>
                  <TableHead>Bật</TableHead>
                  <TableHead>Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[240px]">{s.url ?? "—"}</div>
                    </TableCell>
                    <TableCell className="text-xs">{SOURCE_TYPE_LABELS[s.type] ?? s.type}</TableCell>
                    <TableCell>
                      <Badge variant={s.accessPolicy === "ALLOWED" ? "default" : "secondary"} className={s.accessPolicy === "ALLOWED" ? "bg-emerald-600" : ""}>
                        {s.accessPolicy === "ALLOWED" ? "Được phép" : s.accessPolicy === "REVIEW_REQUIRED" ? "Chờ xem xét" : "Cấm"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{s.robotsStatus ?? "—"}</TableCell>
                    <TableCell className="text-xs">{s._count.sourceRecords}</TableCell>
                    <TableCell className="text-xs">{fmtDate(s.lastRunAt)}</TableCell>
                    <TableCell>
                      <Switch checked={s.isActive} onCheckedChange={(v) => toggleActive(s, v)} aria-label={`Bật nguồn ${s.name}`} />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => checkSource(s)}>Kiểm tra</Button>
                        <Button size="sm" variant="outline" onClick={() => createJob(s)} disabled={!s.isActive}>Chạy job</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Công việc thu thập (Collection Jobs)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {!jobs ? <div className="p-4"><Skeleton className="h-10" /></div> : jobs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Chưa có job nào.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nguồn</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="text-right">Phát hiện</TableHead>
                  <TableHead className="text-right">Hợp lệ</TableHead>
                  <TableHead className="text-right">Trùng</TableHead>
                  <TableHead className="text-right">Lỗi</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead>Điều khiển</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">{j.source.name}</TableCell>
                    <TableCell><Badge variant="secondary">{j.status}</Badge></TableCell>
                    <TableCell className="text-right">{j.discoveredCount}</TableCell>
                    <TableCell className="text-right">{j.validCount}</TableCell>
                    <TableCell className="text-right">{j.duplicateCount}</TableCell>
                    <TableCell className="text-right">{j.errorCount}</TableCell>
                    <TableCell className="text-xs">{fmtDate(j.createdAt)}{j.finishedAt ? ` → ${fmtDate(j.finishedAt)}` : ""}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {j.status === "RUNNING" && <Button size="sm" variant="outline" onClick={() => controlJob(j, "pause")}><Pause className="h-3 w-3" /></Button>}
                        {j.status === "PAUSED" && <Button size="sm" variant="outline" onClick={() => controlJob(j, "resume")}><Play className="h-3 w-3" /></Button>}
                        {["RUNNING", "PAUSED", "PENDING"].includes(j.status) && <Button size="sm" variant="outline" onClick={() => controlJob(j, "cancel")}><Square className="h-3 w-3" /></Button>}
                        {["FAILED", "CANCELLED"].includes(j.status) && <Button size="sm" variant="outline" onClick={() => controlJob(j, "retry")}><RotateCcw className="h-3 w-3" /></Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type ProbeResult = {
  name: string; type: string; url: string; description: string;
  robotsStatus: string; robotsNote: string;
  reachable: boolean; httpStatus: number | null;
  alreadyRegistered: boolean; registered: boolean; note: string;
};

function DiscoveryDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [customUrl, setCustomUrl] = useState("");

  async function run(urls?: string[]) {
    setBusy(true);
    setResults(null);
    try {
      const r = await api<{ results: ProbeResult[]; registered: number }>("/api/discovery", { method: "POST", body: JSON.stringify(urls ? { urls } : {}) });
      setResults(r.results);
      toast.success(`Đã dò ${r.results.length} ứng viên — thêm mới ${r.registered} nguồn (mặc định tắt, chờ xem xét)`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResults(null); }}>
      <DialogTrigger asChild><Button variant="outline"><Radar className="h-4 w-4 mr-1" /> Tự động dò nguồn</Button></DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Tự động dò ứng viên nguồn dữ liệu</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Hệ thống tự kiểm tra robots.txt + khả năng truy cập HTTP của các danh bạ/cổng công khai phổ biến
          (và URL tùy chọn nếu nhập) rồi thêm vào danh mục ở trạng thái <b>chờ xem xét + tắt</b>.
          Bạn xác minh điều khoản sử dụng dữ liệu rồi mới bật thu thập.
        </p>
        <div className="flex gap-2">
          <Input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="URL tùy chọn (https://...) — có thể bỏ trống" />
          <Button onClick={() => run(customUrl ? [customUrl] : undefined)} disabled={busy}>
            {busy ? "Đang dò... (tối đa ~15s)" : "Dò ngay"}
          </Button>
        </div>
        {results && (
          <div className="max-h-[360px] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ứng viên</TableHead>
                  <TableHead>robots</TableHead>
                  <TableHead>Truy cập</TableHead>
                  <TableHead>Kết quả</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.url}>
                    <TableCell>
                      <div className="font-medium text-sm">{r.name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.url}</div>
                    </TableCell>
                    <TableCell className="text-xs">{r.robotsStatus}</TableCell>
                    <TableCell className="text-xs">{r.reachable ? `OK (HTTP ${r.httpStatus})` : `Không (HTTP ${r.httpStatus ?? "—"})`}</TableCell>
                    <TableCell>
                      <Badge variant={r.registered ? "default" : "secondary"} className={r.registered ? "bg-emerald-600" : ""}>
                        {r.registered ? "Đã thêm mới" : r.alreadyRegistered ? "Đã có sẵn" : "Chưa thêm"}
                      </Badge>
                      <div className="mt-1 text-xs text-muted-foreground max-w-[220px]">{r.note}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddSourceDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", type: "PUBLIC_DIRECTORY", url: "", allowedScope: "", dataRightsNote: "", accessPolicy: "REVIEW_REQUIRED" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("/api/sources", { method: "POST", body: JSON.stringify({ ...form, url: form.url || undefined }) });
      toast.success("Đã thêm nguồn (mặc định tắt, chờ xem xét)");
      setForm({ name: "", type: "PUBLIC_DIRECTORY", url: "", allowedScope: "", dataRightsNote: "", accessPolicy: "REVIEW_REQUIRED" });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-1" /> Thêm nguồn</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Thêm nguồn dữ liệu</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Tên nguồn *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <Label>Loại nguồn</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>URL</Label><Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://..." /></div>
          <div><Label>Phạm vi dữ liệu được phép thu thập</Label><Textarea rows={2} value={form.allowedScope} onChange={(e) => setForm({ ...form, allowedScope: e.target.value })} /></div>
          <div><Label>Ghi chú quyền sử dụng dữ liệu</Label><Input value={form.dataRightsNote} onChange={(e) => setForm({ ...form, dataRightsNote: e.target.value })} /></div>
          <div>
            <Label>Chính sách truy cập</Label>
            <Select value={form.accessPolicy} onValueChange={(v) => setForm({ ...form, accessPolicy: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="REVIEW_REQUIRED">Chờ xem xét (mặc định)</SelectItem>
                <SelectItem value="ALLOWED">Được phép (đã xác minh)</SelectItem>
                <SelectItem value="DISALLOWED">Cấm</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">Nguồn mạng chỉ chạy được khi: policy = ALLOWED, robots.txt không cấm, và đã bấm &quot;Kiểm tra&quot;.</p>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy || form.name.length < 2}>{busy ? "Đang lưu..." : "Lưu"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
