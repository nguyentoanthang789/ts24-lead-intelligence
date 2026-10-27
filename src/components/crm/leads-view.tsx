"use client";
// Trang 2 — Lead Explorer: tìm kiếm, lọc, phân trang phía máy chủ, import, xuất
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Download, FileUp, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, TIER_LABELS, PRODUCT_NAMES } from "@/lib/crm-api";
import { TierBadge, StatusBadge, VerificationBadge } from "@/components/crm/badges";
import { LeadDetailSheet } from "@/components/crm/lead-detail";

type CompanyRow = {
  id: string; name: string; taxCode: string | null; province: string | null; sector: string | null;
  priorityTier: string; outreachStatus: string; verificationStatus: string; updatedAt: string;
  contactPoints: { id: string; type: string; normalized: string }[];
  productFits: { productCode: string; fitScore: number }[];
  leadScores: { totalScore: number }[];
  sourceRecords: { source: { name: string } }[];
};

type ListResult = { items: CompanyRow[]; total: number; page: number; pageSize: number };

export function LeadsView({ onOpenLead }: { onOpenLead?: (id: string) => void }) {
  const [data, setData] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [product, setProduct] = useState("");
  const [province, setProvince] = useState("");
  const [verification, setVerification] = useState("");
  const [sort, setSort] = useState("recent");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const sp = new URLSearchParams({ page: String(page), pageSize: "15", sort });
      if (q) sp.set("q", q);
      if (tier) sp.set("tier", tier);
      if (product) sp.set("product", product);
      if (province) sp.set("province", province);
      if (verification) sp.set("verification", verification);
      setData(await api<ListResult>(`/api/companies?${sp.toString()}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page, q, tier, product, province, verification, sort]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount, setState diễn ra sau await
    load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Tìm theo tên hoặc mã số thuế..." className="pl-8" value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <Select value={tier} onValueChange={(v) => { setTier(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Phân hạng" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả hạng</SelectItem>
            {Object.entries(TIER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={product} onValueChange={(v) => { setProduct(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Sản phẩm" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả sản phẩm</SelectItem>
            {Object.entries(PRODUCT_NAMES).map(([k, v]) => <SelectItem key={k} value={k}>{k} — {v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={verification} onValueChange={(v) => { setVerification(v === "all" ? "" : v); setPage(1); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Xác minh" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi trạng thái</SelectItem>
            <SelectItem value="VERIFIED">Đã xác minh</SelectItem>
            <SelectItem value="PARTIALLY_VERIFIED">Xác minh một phần</SelectItem>
            <SelectItem value="UNVERIFIED">Chưa xác minh</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Sắp xếp" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Điểm cao trước</SelectItem>
            <SelectItem value="recent">Mới cập nhật</SelectItem>
            <SelectItem value="name">Tên A-Z</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => window.open(`/api/export?view=companies${tier ? `&tier=${tier}` : ""}${product ? `&product=${product}` : ""}`, "_blank")}>
          <Download className="h-4 w-4 mr-1" /> Xuất CSV
        </Button>
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => { setImportOpen(false); load(); }} />
        <AddCompanyDialog open={addOpen} onOpenChange={setAddOpen} onDone={() => { setAddOpen(false); load(); }} />
      </div>

      {error && <Alert variant="destructive"><AlertTitle>Lỗi</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}

      <Card>
        <CardContent className="p-0">
          {!data ? (
            <div className="p-4 space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : data.items.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              Không có lead nào khớp bộ lọc. Hãy import danh sách doanh nghiệp (CSV/XLSX) hoặc thêm thủ công.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doanh nghiệp</TableHead>
                  <TableHead>MST</TableHead>
                  <TableHead>Khu vực</TableHead>
                  <TableHead>Phù hợp nhất</TableHead>
                  <TableHead className="text-right">Điểm</TableHead>
                  <TableHead>Phân hạng</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Xác minh</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => { setSelectedId(c.id); onOpenLead?.(c.id); }}>
                    <TableCell>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.sector ?? "Chưa rõ ngành"} · {c.sourceRecords[0]?.source.name ?? "—"}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.taxCode ?? "—"}</TableCell>
                    <TableCell>{c.province ?? "—"}</TableCell>
                    <TableCell>
                      {c.productFits[0] ? (
                        <span className="text-xs">
                          <b>{c.productFits[0].productCode}</b> {PRODUCT_NAMES[c.productFits[0].productCode] ?? ""} ({c.productFits[0].fitScore})
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-bold">{c.leadScores[0]?.totalScore ?? "—"}</TableCell>
                    <TableCell><TierBadge tier={c.priorityTier} /></TableCell>
                    <TableCell><StatusBadge status={c.outreachStatus} /></TableCell>
                    <TableCell><VerificationBadge status={c.verificationStatus} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Tổng {data.total} lead · trang {page}/{totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Trước</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Sau</Button>
          </div>
        </div>
      )}

      <LeadDetailSheet companyId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
    </div>
  );
}

function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function submit() {
    if (!file) { toast.error("Hãy chọn tệp CSV hoặc XLSX"); return; }
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sourceName", `Tệp: ${file.name}`);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? "Import thất bại");
      const r = json.data;
      setResult(
        `Tổng ${r.totalRows} dòng — tạo mới ${r.createdCompanies}, hợp nhất ${r.mergedCompanies}, ` +
        `trùng ${r.duplicateRecords}, lỗi ${r.errorRows}, chờ xem xét ${r.needsReview}.`
      );
      toast.success("Import hoàn tất");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline"><FileUp className="h-4 w-4 mr-1" /> Import CSV/XLSX</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import danh sách doanh nghiệp</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Hỗ trợ CSV (phẩy/chấm phẩy/tab) và XLSX. Cột nhận diện: ten_doanh_nghiep, ma_so_thue, dien_thoai, email, website, tinh, nganh_nghe, nam_thanh_lap, trang_thai.{" "}
            <a className="underline" href="/api/import" target="_blank">Tải tệp mẫu</a>
          </p>
          <Input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {result && <Alert><AlertDescription>{result}</AlertDescription></Alert>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={busy}>{busy ? "Đang xử lý..." : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCompanyDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", taxCode: "", phone: "", email: "", website: "", province: "", sector: "", address: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setBusy(true);
    try {
      await api("/api/companies", { method: "POST", body: JSON.stringify(form) });
      toast.success("Đã thêm doanh nghiệp (đã qua chuẩn hóa + khử trùng lặp)");
      setForm({ name: "", taxCode: "", phone: "", email: "", website: "", province: "", sector: "", address: "" });
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button><UserPlus className="h-4 w-4 mr-1" /> Thêm thủ công</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Thêm doanh nghiệp (nhập thủ công)</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Label>Tên doanh nghiệp *</Label><Input value={form.name} onChange={set("name")} /></div>
          <div><Label>Mã số thuế</Label><Input value={form.taxCode} onChange={set("taxCode")} placeholder="10 hoặc 13 số" /></div>
          <div><Label>Điện thoại</Label><Input value={form.phone} onChange={set("phone")} placeholder="09xx / 02xx..." /></div>
          <div><Label>Email công ty</Label><Input value={form.email} onChange={set("email")} /></div>
          <div><Label>Website</Label><Input value={form.website} onChange={set("website")} /></div>
          <div><Label>Tỉnh/Thành</Label><Input value={form.province} onChange={set("province")} /></div>
          <div><Label>Ngành nghề</Label><Input value={form.sector} onChange={set("sector")} /></div>
          <div className="sm:col-span-2"><Label>Địa chỉ</Label><Input value={form.address} onChange={set("address")} /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy || form.name.length < 2}>{busy ? "Đang lưu..." : "Lưu"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
