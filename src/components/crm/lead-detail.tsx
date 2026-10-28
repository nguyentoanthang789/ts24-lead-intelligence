"use client";
// Hồ sơ doanh nghiệp: nguồn gốc, bằng chứng, điểm có giải thích, chỉnh sửa,
// và quy trình tiếp cận Zalo THỦ CÔNG (không tự gửi tin)
import { useCallback, useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, ExternalLink, MessageSquare, PenLine, Plus, RefreshCw, ShieldOff, CalendarClock, History } from "lucide-react";
import { toast } from "sonner";
import { api, fmtDate, EVENT_LABELS, PRODUCT_NAMES, ZALO_WEB_URL } from "@/lib/crm-api";
import { TierBadge, StatusBadge, VerificationBadge, ConfidenceBadge } from "@/components/crm/badges";

type CompanyDetail = {
  id: string; name: string; rawName: string | null; taxCode: string | null; taxCodeStatus: string; contactName: string | null;
  province: string | null; address: string | null; website: string | null; domain: string | null;
  sector: string | null; businessStatus: string; sizeSignal: string | null; establishedYear: number | null;
  verificationStatus: string; priorityTier: string; outreachStatus: string; internalNotes: string | null;
  createdAt: string; updatedAt: string;
  contactPoints: { id: string; type: string; value: string; normalized: string; status: string }[];
  sourceRecords: { id: string; status: string; payload: string; collectedAt: string; errorMessage: string | null; source: { id: string; name: string; type: string } }[];
  evidences: { id: string; kind: string; summary: string; sourceUrl: string | null; sourceName: string | null; confidence: string; recordedAt: string }[];
  productFits: { productCode: string; fitScore: number; reasons: string; missingFields: string; needsVerification: boolean }[];
  leadScores: { totalScore: number; productFitScore: number; evidenceScore: number; segmentScore: number; contactScore: number; freshnessScore: number; ruleVersion: string; tier: string; explanation: string; computedAt: string }[];
  outreachEvents: { id: string; type: string; note: string | null; actor: string; occurredAt: string }[];
  outreachTasks: { id: string; status: string; draftContent: string | null; scheduledAt: string | null }[];
};

type TemplateRow = { id: string; name: string; productCode: string | null; body: string; isActive: boolean };

export function LeadDetailSheet({ companyId, onClose, onChanged }: { companyId: string | null; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<CompanyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [draftOpen, setDraftOpen] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setError(null);
    try {
      const data = await api<CompanyDetail>(`/api/companies/${companyId}`);
      setC(data);
      const t = await api<TemplateRow[]>("/api/templates");
      setTemplates(t.filter((x) => x.isActive));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, setState diễn ra sau await
      load();
    }
  }, [companyId, load]);

  async function recordEvent(type: string, note?: string, extra?: Record<string, unknown>) {
    if (!companyId) return;
    try {
      await api("/api/outreach/events", { method: "POST", body: JSON.stringify({ companyId, type, note, ...extra }) });
      toast.success(`Đã ghi nhận: ${EVENT_LABELS[type] ?? type}`);
      await load();
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Sheet open={!!companyId} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{c?.name ?? "Hồ sơ doanh nghiệp"}</SheetTitle>
          <SheetDescription className="text-left">
            {c && <span className="flex flex-wrap gap-1.5 mt-1">
              <TierBadge tier={c.priorityTier} />
              <StatusBadge status={c.outreachStatus} />
              <VerificationBadge status={c.verificationStatus} />
            </span>}
          </SheetDescription>
        </SheetHeader>
        {error && <Alert variant="destructive" className="mt-3"><AlertTitle>Lỗi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {!c && !error && <div className="p-4 space-y-2"><Skeleton className="h-8" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>}
        {c && (
          <Tabs defaultValue="profile" className="mt-2">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="profile">Hồ sơ</TabsTrigger>
              <TabsTrigger value="evidence">Bằng chứng</TabsTrigger>
              <TabsTrigger value="score">Điểm &amp; fit</TabsTrigger>
              <TabsTrigger value="history">Lịch sử</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-4">
              <ProfileTab company={c} onSaved={load} />
            </TabsContent>

            <TabsContent value="evidence" className="space-y-3">
              <EvidenceTab company={c} onSaved={load} />
            </TabsContent>

            <TabsContent value="score" className="space-y-4">
              <ScoreTab company={c} />
            </TabsContent>

            <TabsContent value="history" className="space-y-4">
              <HistoryTab company={c} />
            </TabsContent>
          </Tabs>
        )}

        {c && (
          <div className="mt-6 space-y-2">
            <Separator />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setDraftOpen(true)}>
                <MessageSquare className="h-4 w-4 mr-1" /> Tạo bản nháp
              </Button>
              <Button size="sm" variant="outline" onClick={() => recordEvent("MARKED_CONTACTED")}>
                <PenLine className="h-4 w-4 mr-1" /> Đánh dấu đã liên hệ
              </Button>
              <Button size="sm" variant="outline" onClick={() => recordEvent("REPLIED")}>Ghi nhận phản hồi</Button>
              <Button size="sm" variant="outline" onClick={() => recordEvent("INTERESTED")}>Ghi nhận quan tâm</Button>
              <Button size="sm" variant="outline" onClick={() => {
                const d = prompt("Ngày nhắc theo dõi (YYYY-MM-DD):");
                if (d) recordEvent("FOLLOW_UP", `Hẹn theo dõi ${d}`, { scheduledAt: new Date(`${d}T09:00:00`).toISOString() });
              }}>
                <CalendarClock className="h-4 w-4 mr-1" /> Lịch theo dõi
              </Button>
              <Button size="sm" variant="outline" onClick={() => recordEvent("NOT_SUITABLE")}>Không phù hợp</Button>
              <Button size="sm" variant="outline" onClick={() => recordEvent("DO_NOT_CONTACT")}>
                <ShieldOff className="h-4 w-4 mr-1" /> Không tiếp tục liên hệ
              </Button>
              <Button size="sm" variant="ghost" onClick={() => recordEvent("RETURNED_TO_VERIFICATION")}>
                <RefreshCw className="h-4 w-4 mr-1" /> Trả về hàng xác minh
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Hệ thống chỉ ghi lại thao tác bạn xác nhận. Việc gửi tin nhắn do bạn thực hiện trực tiếp trên Zalo.
            </p>
          </div>
        )}

        {c && (
          <DraftDialog
            open={draftOpen}
            onOpenChange={setDraftOpen}
            company={c}
            templates={templates}
            onEvent={recordEvent}
            onDone={() => { load(); onChanged(); }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------- Tabs ----------

function ProfileTab({ company: c, onSaved }: { company: CompanyDetail; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: c.name, taxCode: c.taxCode ?? "", province: c.province ?? "", address: c.address ?? "",
    website: c.website ?? "", sector: c.sector ?? "", internalNotes: c.internalNotes ?? "",
    addPhone: "", addEmail: "",
  });

  async function save() {
    setBusy(true);
    try {
      await api(`/api/companies/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          taxCode: form.taxCode || undefined,
          province: form.province || undefined,
          address: form.address || undefined,
          website: form.website || undefined,
          sector: form.sector || undefined,
          internalNotes: form.internalNotes || null,
          ...(form.addPhone ? { addPhone: form.addPhone } : {}),
          ...(form.addEmail ? { addEmail: form.addEmail } : {}),
        }),
      });
      toast.success("Đã cập nhật và chấm điểm lại");
      setEdit(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <InfoRow label="Tên gốc (raw)" value={c.rawName ?? "—"} />
        <InfoRow label="Mã số thuế" value={c.taxCode ? `${c.taxCode} (${c.taxCodeStatus === "VERIFIED" ? "checksum hợp lệ" : "chưa xác minh"})` : "—"} />
        <InfoRow label="Người liên lạc" value={c.contactName ?? "—"} />
        <InfoRow label="Tỉnh/Thành" value={c.province ?? "—"} />
        <InfoRow label="Ngành nghề" value={c.sector ?? "—"} />
        <InfoRow label="Website" value={c.website ?? "—"} />
        <InfoRow label="Trạng thái hoạt động" value={c.businessStatus === "UNKNOWN" ? "Chưa xác minh từ nguồn tin cậy" : c.businessStatus} />
        <InfoRow label="Thành lập" value={c.establishedYear ? String(c.establishedYear) : "—"} />
        <InfoRow label="Tín hiệu quy mô" value={c.sizeSignal ?? "Không có nguồn xác thực — không suy luận"} />
      </div>
      <div>
        <div className="font-medium mb-1">Kênh liên hệ công khai</div>
        {c.contactPoints.length === 0 ? <p className="text-muted-foreground">Chưa có kênh liên hệ nào được ghi nhận.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {c.contactPoints.map((p) => (
              <Badge key={p.id} variant="outline" className="font-mono">
                {p.type === "PHONE" ? "📞" : p.type === "EMAIL" ? "✉" : "🔗"} {p.value}
              </Badge>
            ))}
          </div>
        )}
      </div>
      {!edit ? (
        <Button size="sm" variant="outline" onClick={() => setEdit(true)}><PenLine className="h-4 w-4 mr-1" /> Chỉnh sửa dữ liệu</Button>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Tên</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>MST</Label><Input value={form.taxCode} onChange={(e) => setForm({ ...form, taxCode: e.target.value })} /></div>
            <div><Label>Tỉnh/Thành</Label><Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} /></div>
            <div><Label>Ngành nghề</Label><Input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} /></div>
            <div><Label>Website</Label><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></div>
            <div><Label>Địa chỉ</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div><Label>Thêm SĐT</Label><Input value={form.addPhone} onChange={(e) => setForm({ ...form, addPhone: e.target.value })} placeholder="tuỳ chọn" /></div>
            <div><Label>Thêm email</Label><Input value={form.addEmail} onChange={(e) => setForm({ ...form, addEmail: e.target.value })} placeholder="tuỳ chọn" /></div>
            <div className="col-span-2"><Label>Ghi chú nội bộ</Label><Textarea rows={2} value={form.internalNotes} onChange={(e) => setForm({ ...form, internalNotes: e.target.value })} /></div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Đang lưu..." : "Lưu"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Hủy</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium break-all">{value}</div>
    </div>
  );
}

function EvidenceTab({ company: c, onSaved }: { company: CompanyDetail; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "OTHER", summary: "", sourceUrl: "", confidence: "MEDIUM" });
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await api(`/api/companies/${c.id}`, {
        method: "PATCH",
        body: JSON.stringify({ addEvidence: { kind: form.kind, summary: form.summary, sourceUrl: form.sourceUrl || "", confidence: form.confidence } }),
      });
      toast.success("Đã thêm bằng chứng");
      setOpen(false);
      setForm({ kind: "OTHER", summary: "", sourceUrl: "", confidence: "MEDIUM" });
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <Button size="sm" variant="outline" onClick={() => setOpen(!open)}><Plus className="h-4 w-4 mr-1" /> Thêm bằng chứng (kèm nguồn)</Button>
      {open && (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Loại</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["HIRING", "HIRING_ACCOUNTANT", "ACCOUNTING_ACTIVITY", "EXPANSION", "BRANCHES", "MULTI_DEPT", "DIGITIZATION_SIGNAL", "PROCESS_SIGNAL", "E_SIGN_SIGNAL", "DOCUMENT", "OTHER"].map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Độ tin cậy</Label>
              <Select value={form.confidence} onValueChange={(v) => setForm({ ...form, confidence: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="HIGH">HIGH</SelectItem><SelectItem value="MEDIUM">MEDIUM</SelectItem><SelectItem value="LOW">LOW</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Mô tả bằng chứng (chỉ ghi nhận thông tin có thật)</Label><Textarea rows={2} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /></div>
          <div><Label>URL nguồn</Label><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} placeholder="https://..." /></div>
          <Button size="sm" onClick={add} disabled={busy || form.summary.length < 3}>Lưu bằng chứng</Button>
        </div>
      )}
      {c.evidences.length === 0 ? <p className="text-muted-foreground">Chưa có bằng chứng nào.</p> : c.evidences.map((ev) => (
        <div key={ev.id} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">{ev.kind}</Badge>
            <ConfidenceBadge confidence={ev.confidence} />
          </div>
          <p className="mt-1">{ev.summary}</p>
          <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
            <span>Nguồn: {ev.sourceName ?? "—"} · {fmtDate(ev.recordedAt)}</span>
            {ev.sourceUrl && <a href={ev.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">Xem nguồn <ExternalLink className="h-3 w-3" /></a>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScoreTab({ company: c }: { company: CompanyDetail }) {
  const latest = c.leadScores[0];
  if (!latest) return <p className="text-sm text-muted-foreground">Chưa có kết quả chấm điểm. Bấm &quot;Chạy lại chấm điểm&quot; ở Cài đặt.</p>;
  const explanation = JSON.parse(latest.explanation) as {
    components: Record<string, { score: number; max: number; explanation: string }>;
    tierReason: string; confidence: string;
  };
  const comps = [
    ["productFit", "Phù hợp sản phẩm"], ["evidence", "Bằng chứng nhu cầu"], ["segment", "Phân khúc"],
    ["contact", "Khả năng liên hệ"], ["freshness", "Độ mới dữ liệu"],
  ] as const;
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl border p-4 text-center">
        <div className="text-4xl font-bold">{latest.totalScore}<span className="text-lg text-muted-foreground">/100</span></div>
        <div className="mt-1 flex items-center justify-center gap-2">
          <TierBadge tier={latest.tier} />
          <Badge variant="outline">{latest.ruleVersion}</Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{explanation.tierReason}</p>
      </div>
      {comps.map(([k, label]) => {
        const comp = explanation.components[k];
        if (!comp) return null;
        return (
          <div key={k}>
            <div className="flex justify-between text-xs mb-1">
              <span>{label}</span><span>{comp.score}/{comp.max}</span>
            </div>
            <div className="h-2 rounded bg-stone-100">
              <div className="h-2 rounded bg-emerald-500" style={{ width: `${(comp.score / comp.max) * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{comp.explanation}</p>
          </div>
        );
      })}
      <Separator />
      <div>
        <div className="font-medium mb-2">Điểm phù hợp từng sản phẩm</div>
        <div className="space-y-2">
          {c.productFits.map((f) => {
            const reasons = JSON.parse(f.reasons) as string[];
            return (
              <div key={f.productCode} className="rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{f.productCode} — {PRODUCT_NAMES[f.productCode]}</span>
                  <span className="font-bold">{f.fitScore}/100 {f.needsVerification && <Badge variant="outline" className="ml-1">cần xác minh</Badge>}</span>
                </div>
                <div className="h-1.5 mt-1 rounded bg-stone-100">
                  <div className="h-1.5 rounded bg-teal-500" style={{ width: `${f.fitScore}%` }} />
                </div>
                {reasons.length > 0 ? (
                  <ul className="mt-1.5 list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
                    {reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                ) : <p className="text-xs text-muted-foreground mt-1">Không có tín hiệu khớp — không cho điểm theo quy mô.</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HistoryTab({ company: c }: { company: CompanyDetail }) {
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="font-medium mb-1 flex items-center gap-1"><History className="h-4 w-4" /> Nguồn gốc dữ liệu (Source Records)</div>
        {c.sourceRecords.length === 0 ? <p className="text-muted-foreground">Không có bản ghi nguồn.</p> : c.sourceRecords.map((r) => (
          <div key={r.id} className="rounded-lg border p-2.5 mb-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.source.name}</span>
              <Badge variant="secondary">{r.status}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">{fmtDate(r.collectedAt)}{r.errorMessage ? ` · ${r.errorMessage}` : ""}</div>
            <details className="mt-1">
              <summary className="text-xs underline cursor-pointer">Payload gốc</summary>
              <pre className="mt-1 text-[10px] whitespace-pre-wrap break-all bg-stone-50 rounded p-2 max-h-32 overflow-y-auto">{r.payload}</pre>
            </details>
          </div>
        ))}
      </div>
      <div>
        <div className="font-medium mb-1">Lịch sử tương tác (thao tác đã xác nhận)</div>
        {c.outreachEvents.length === 0 ? <p className="text-muted-foreground">Chưa có sự kiện nào.</p> : (
          <ol className="space-y-1.5 border-l pl-3">
            {c.outreachEvents.map((e) => (
              <li key={e.id} className="text-xs">
                <b>{EVENT_LABELS[e.type] ?? e.type}</b> — {fmtDate(e.occurredAt)} {e.note ? `· ${e.note}` : ""}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// ---------- Draft + Zalo workflow ----------

function DraftDialog({ open, onOpenChange, company, templates, onEvent, onDone }: {
  open: boolean; onOpenChange: (v: boolean) => void; company: CompanyDetail;
  templates: TemplateRow[]; onEvent: (type: string, note?: string) => Promise<void>; onDone: () => void;
}) {
  const [templateId, setTemplateId] = useState<string>("");
  const [content, setContent] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open && templates.length > 0 && !templateId) setTemplateId(templates[0].id);
  }, [open, templates, templateId]);

  async function generate() {
    setBusy(true);
    try {
      // tạo task nếu chưa có
      let tid = company.outreachTasks.find((t) => ["NEW", "CONTENT_READY", "AWAITING_CONTACT", "FOLLOW_UP"].includes(t.status))?.id;
      if (!tid) {
        const res = await api<{ created: string[] }>("/api/outreach", {
          method: "POST",
          body: JSON.stringify({ companyIds: [company.id] }),
        });
        tid = res.created[0];
      }
      setTaskId(tid);
      const r = await api<{ content: string; missingVariables: string[] }>("/api/outreach/draft", {
        method: "POST",
        body: JSON.stringify({ companyId: company.id, templateId, taskId: tid }),
      });
      setContent(r.content);
      setMissing(r.missingVariables);
      toast.success(r.missingVariables.length > 0
        ? `Đã tạo bản nháp — thiếu biến: ${r.missingVariables.join(", ")}. Hãy bổ sung bằng cách sửa nội dung, hệ thống không tự điền.`
        : "Đã tạo bản nháp");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      await onEvent("CONTENT_COPIED", "Người dùng sao chép bản nháp đã duyệt");
      toast.success("Đã sao chép nội dung");
    } catch {
      toast.error("Không sao chép được — hãy chọn thủ công");
    }
  }

  function openZalo() {
    // Chỉ mở trang Zalo Web chính thức trong tab mới. KHÔNG truyền dữ liệu người nhận, KHÔNG tự động thao tác.
    window.open(ZALO_WEB_URL, "_blank", "noopener,noreferrer");
    void onEvent("ZALO_OPENED", "Người dùng chủ động mở Zalo Web");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Tạo bản nháp tin nhắn tiếp cận</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Mẫu tin nhắn</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Chọn mẫu..." /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}{t.productCode ? ` (${t.productCode})` : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" onClick={generate} disabled={busy || !templateId}>{busy ? "Đang tạo..." : "Tạo bản nháp"}</Button>
          {content && (
            <>
              {missing.length > 0 && (
                <Alert>
                  <AlertTitle className="text-sm">Thiếu dữ liệu cho biến: {missing.join(", ")}</AlertTitle>
                  <AlertDescription className="text-xs">
                    Hệ thống không tự điền dữ liệu thiếu và không bịa nội dung. Hãy sửa trực tiếp nội dung bên dưới trước khi sao chép.
                  </AlertDescription>
                </Alert>
              )}
              <div>
                <Label>Nội dung (bạn có thể sửa trước khi sao chép)</Label>
                <Textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={copy}><Copy className="h-4 w-4 mr-1" /> Sao chép tin nhắn</Button>
                <Button size="sm" variant="outline" onClick={openZalo}><ExternalLink className="h-4 w-4 mr-1" /> Mở Zalo Web</Button>
              </div>
              <ol className="text-xs text-muted-foreground list-decimal pl-4 space-y-0.5">
                <li>Sao chép nội dung đã duyệt</li>
                <li>Mở Zalo Web và tự chọn đúng người nhận</li>
                <li>Tự kiểm tra và gửi trên Zalo</li>
                <li>Quay lại đây, bấm &quot;Đánh dấu đã liên hệ&quot; và nhập kết quả</li>
              </ol>
              {taskId && <p className="text-[10px] text-muted-foreground">Task ID: {taskId}</p>}
            </>
          )}
        </div>
        <DialogFooter />
      </DialogContent>
    </Dialog>
  );
}
