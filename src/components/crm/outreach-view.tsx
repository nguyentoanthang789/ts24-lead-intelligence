"use client";
// Trang 5 — Campaign & Outreach Queue: chiến dịch, hàng đợi, bản nháp, ghi nhận thủ công
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Copy, ExternalLink, Plus } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate, OUTREACH_STATUS_LABELS, EVENT_LABELS, PRODUCT_NAMES, ZALO_WEB_URL } from "@/lib/crm-api";
import { StatusBadge, TierBadge } from "@/components/crm/badges";
import { LeadDetailSheet } from "@/components/crm/lead-detail";

type Campaign = { id: string; name: string; productCode: string | null; status: string; goalNote: string | null; _count: { outreachTasks: number } };
type Task = {
  id: string; status: string; draftContent: string | null; scheduledAt: string | null; updatedAt: string; notes: string | null;
  company: { id: string; name: string; province: string | null; priorityTier: string; productFits: { productCode: string; fitScore: number }[] };
  campaign: { id: string; name: string } | null;
};

export function OutreachView() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCampaigns(await api<Campaign[]>("/api/campaigns"));
      const sp = new URLSearchParams({ pageSize: "30" });
      if (statusFilter) sp.set("status", statusFilter);
      setTasks((await api<{ items: Task[] }>(`/api/outreach?${sp}`)).items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [statusFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, setState diễn ra sau await
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <Alert>
        <AlertTitle>Quy trình tiếp cận qua Zalo cá nhân — tự gửi tin, hệ thống chỉ hỗ trợ chuẩn bị</AlertTitle>
        <AlertDescription>
          1) Chọn lead → 2) tạo bản nháp từ mẫu → 3) xem lại/sửa → 4) bấm <b>Sao chép tin nhắn</b> → 5) bấm <b>Mở Zalo Web</b> →
          6) tự chọn người nhận và tự gửi trên Zalo → 7) quay lại ghi nhận kết quả. Hệ thống không tự gửi, không tự kết bạn, không đọc dữ liệu phiên đăng nhập Zalo.
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Hàng đợi tiếp cận</TabsTrigger>
          <TabsTrigger value="campaigns">Chiến dịch</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Lọc theo trạng thái" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả trạng thái</SelectItem>
                {Object.entries(OUTREACH_STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              {!tasks ? <div className="p-4 space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
                : tasks.length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground text-center">
                    Hàng đợi trống. Mở Lead Explorer → chọn lead → bấm &quot;Tạo bản nháp&quot; để đưa vào hàng đợi.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Doanh nghiệp</TableHead>
                        <TableHead>Phân hạng</TableHead>
                        <TableHead>Sản phẩm đề xuất</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Nhắc theo dõi</TableHead>
                        <TableHead>Cập nhật</TableHead>
                        <TableHead>Thao tác nhanh</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell>
                            <button className="font-medium hover:underline text-left" onClick={() => setSelectedLead(t.company.id)}>{t.company.name}</button>
                            <div className="text-xs text-muted-foreground">{t.company.province ?? "—"}{t.campaign ? ` · ${t.campaign.name}` : ""}</div>
                          </TableCell>
                          <TableCell><TierBadge tier={t.company.priorityTier} /></TableCell>
                          <TableCell className="text-xs">
                            {t.company.productFits[0] ? <b>{t.company.productFits[0].productCode}</b> : "—"}
                          </TableCell>
                          <TableCell><StatusBadge status={t.status} /></TableCell>
                          <TableCell className="text-xs">{t.scheduledAt ? fmtDate(t.scheduledAt) : "—"}</TableCell>
                          <TableCell className="text-xs">{fmtDate(t.updatedAt)}</TableCell>
                          <TableCell>
                            <QuickActions task={t} onDone={load} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns">
          <CampaignsTab campaigns={campaigns} onDone={load} />
        </TabsContent>
      </Tabs>

      <LeadDetailSheet companyId={selectedLead} onClose={() => setSelectedLead(null)} onChanged={load} />
    </div>
  );
}

function QuickActions({ task, onDone }: { task: Task; onDone: () => void }) {
  const [draft, setDraft] = useState(task.draftContent ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(type: string, extra?: Record<string, unknown>) {
    setBusy(true);
    try {
      await api("/api/outreach/events", {
        method: "POST",
        body: JSON.stringify({ companyId: task.company.id, taskId: task.id, type, ...(draft && type === "MARKED_CONTACTED" ? { editedContent: draft } : {}), ...extra }),
      });
      toast.success(`Đã ghi nhận: ${EVENT_LABELS[type] ?? type}`);
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copyContent() {
    if (!draft) { toast.error("Chưa có bản nháp — mở chi tiết lead để tạo"); return; }
    navigator.clipboard.writeText(draft)
      .then(() => { toast.success("Đã sao chép"); act("CONTENT_COPIED"); })
      .catch(() => toast.error("Không sao chép được"));
  }

  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>Xử lý</Button>
      <Button size="sm" variant="ghost" onClick={() => window.open(ZALO_WEB_URL, "_blank", "noopener,noreferrer")} title="Mở trang Zalo Web chính thức trong tab mới">
        <ExternalLink className="h-4 w-4" />
      </Button>
      {open && (
        <div className="absolute right-4 z-10 mt-2 w-72 rounded-lg border bg-background p-3 shadow-lg">
          <div className="text-sm font-medium mb-2">{task.company.name}</div>
          <Textarea rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Bản nháp tin nhắn (chỉnh sửa được)" className="text-xs" />
          <div className="flex flex-wrap gap-1 mt-2">
            <Button size="sm" onClick={copyContent} disabled={busy}><Copy className="h-3 w-3 mr-1" /> Sao chép</Button>
            <Button size="sm" variant="outline" onClick={() => act("MARKED_CONTACTED")} disabled={busy}>Đã liên hệ</Button>
            <Button size="sm" variant="outline" onClick={() => act("REPLIED")} disabled={busy}>Phản hồi</Button>
            <Button size="sm" variant="outline" onClick={() => act("INTERESTED")} disabled={busy}>Quan tâm</Button>
            <Button size="sm" variant="outline" onClick={() => act("NOT_SUITABLE")} disabled={busy}>Không phù hợp</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CampaignsTab({ campaigns, onDone }: { campaigns: Campaign[] | null; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", productCode: "", goalNote: "" });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("/api/campaigns", { method: "POST", body: JSON.stringify({ ...form, productCode: form.productCode || undefined }) });
      toast.success("Đã tạo chiến dịch");
      setForm({ name: "", productCode: "", goalNote: "" });
      setOpen(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base">Chiến dịch quản lý lead</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" /> Tạo chiến dịch</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Chiến dịch mới</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Tên *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div>
                <Label>Sản phẩm trọng tâm</Label>
                <Select value={form.productCode || "none"} onValueChange={(v) => setForm({ ...form, productCode: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Không chọn</SelectItem>
                    {Object.entries(PRODUCT_NAMES).map(([k, v]) => <SelectItem key={k} value={k}>{k} — {v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Mục tiêu</Label><Textarea rows={2} value={form.goalNote} onChange={(e) => setForm({ ...form, goalNote: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={submit} disabled={busy || form.name.length < 2}>{busy ? "Đang tạo..." : "Tạo"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {!campaigns ? <div className="p-4"><Skeleton className="h-10" /></div> : campaigns.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Chưa có chiến dịch nào.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Tên</TableHead><TableHead>Sản phẩm</TableHead><TableHead>Trạng thái</TableHead><TableHead className="text-right">Số task</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}{c.goalNote ? <div className="text-xs text-muted-foreground">{c.goalNote}</div> : null}</TableCell>
                  <TableCell>{c.productCode ? <b>{c.productCode}</b> : "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{c.status}</Badge></TableCell>
                  <TableCell className="text-right">{c._count.outreachTasks}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
