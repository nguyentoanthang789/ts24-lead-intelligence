"use client";
// Badge components dùng chung cho CRM
import { Badge } from "@/components/ui/badge";
import { TIER_LABELS, OUTREACH_STATUS_LABELS } from "@/lib/crm-api";

export function TierBadge({ tier }: { tier: string }) {
  const map: Record<string, string> = {
    HIGH: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100",
    NEEDS_VERIFICATION: "bg-amber-100 text-amber-800 hover:bg-amber-100",
    LOW: "bg-stone-100 text-stone-700 hover:bg-stone-100",
    NOT_SUITABLE: "bg-red-100 text-red-700 hover:bg-red-100",
  };
  return <Badge className={map[tier] ?? ""} variant="secondary">{TIER_LABELS[tier] ?? tier}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    NEW: "bg-stone-100 text-stone-700",
    CONTENT_READY: "bg-sky-100 text-sky-800",
    AWAITING_CONTACT: "bg-teal-100 text-teal-800",
    CONTACTED: "bg-violet-100 text-violet-800",
    REPLIED: "bg-cyan-100 text-cyan-800",
    INTERESTED: "bg-emerald-100 text-emerald-800",
    FOLLOW_UP: "bg-amber-100 text-amber-800",
    CONVERTED: "bg-green-200 text-green-900",
    NOT_SUITABLE: "bg-red-100 text-red-700",
    DO_NOT_CONTACT: "bg-red-200 text-red-900",
  };
  return <Badge className={`${map[status] ?? ""} hover:opacity-90`} variant="secondary">{OUTREACH_STATUS_LABELS[status] ?? status}</Badge>;
}

export function VerificationBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    VERIFIED: { cls: "bg-emerald-100 text-emerald-800", label: "Đã xác minh" },
    PARTIALLY_VERIFIED: { cls: "bg-amber-100 text-amber-800", label: "Xác minh một phần" },
    UNVERIFIED: { cls: "bg-stone-100 text-stone-600", label: "Chưa xác minh" },
  };
  const v = map[status] ?? { cls: "", label: status };
  return <Badge className={v.cls} variant="secondary">{v.label}</Badge>;
}

export function SourceStatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  const map: Record<string, { cls: string; label: string }> = {
    OK: { cls: "bg-emerald-100 text-emerald-800", label: "Hoạt động tốt" },
    ERRORS: { cls: "bg-red-100 text-red-700", label: "Có lỗi" },
    NEVER_RUN: { cls: "bg-amber-100 text-amber-800", label: "Chưa chạy" },
    NOT_ACTIVE: { cls: "bg-stone-100 text-stone-600", label: "Tắt" },
    REVIEW: { cls: "bg-amber-100 text-amber-800", label: "Chờ xem xét" },
    READY: { cls: "bg-emerald-100 text-emerald-800", label: "Sẵn sàng" },
  };
  const v = map[status] ?? { cls: "", label: status };
  return <Badge className={v.cls} variant="secondary">{v.label}{status === "OK" && !isActive ? " (tắt)" : ""}</Badge>;
}

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    HIGH: { cls: "bg-emerald-100 text-emerald-800", label: "Tin cậy cao" },
    MEDIUM: { cls: "bg-amber-100 text-amber-800", label: "Tin cậy trung bình" },
    LOW: { cls: "bg-stone-100 text-stone-600", label: "Tin cậy thấp" },
  };
  const v = map[confidence] ?? { cls: "", label: confidence };
  return <Badge className={v.cls} variant="outline">{v.label}</Badge>;
}
