// ============================================================
// Module 9 — Compliance Guard: audit log (đã sanitize) + suppression + purpose
// Quy tắc: không ghi contact values / secrets vào log; lead trong suppression
// KHÔNG được thêm vào hàng đợi tiếp cận
// ============================================================

import { db } from "@/lib/db";

/** Mask giá trị liên hệ để log: chỉ giữ 3 ký tự đầu + độ dài */
export function maskContactValue(v: string): string {
  if (!v) return "";
  return `${v.slice(0, 3)}***(${v.length})`;
}

const SENSITIVE_KEYS = ["phone", "email", "taxcode", "token", "secret", "password", "apikey"];

/** Sanitize object trước khi ghi audit: bỏ/mask trường nhạy cảm */
export function sanitizeForAudit(obj: unknown): string {
  try {
    const walk = (val: unknown): unknown => {
      if (Array.isArray(val)) return val.map(walk);
      if (val && typeof val === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          if (SENSITIVE_KEYS.some((s) => k.toLowerCase().includes(s))) {
            out[k] = typeof v === "string" ? maskContactValue(v) : "***";
          } else out[k] = walk(v);
        }
        return out;
      }
      return val;
    };
    return JSON.stringify(walk(obj));
  } catch {
    return String(obj);
  }
}

export async function audit(input: {
  actor?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: unknown;
}) {
  return db.auditEvent.create({
    data: {
      actor: input.actor ?? "operator",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      detail: input.detail !== undefined ? sanitizeForAudit(input.detail) : null,
    },
  });
}

/** Kiểm tra một công ty có bị loại trừ khỏi tiếp cận không */
export async function isSuppressed(company: {
  id: string;
  taxCode: string | null;
  domain: string | null;
  contactPoints: { type: string; normalized: string }[];
}): Promise<{ suppressed: boolean; reason?: string }> {
  const values = [company.id];
  if (company.taxCode) values.push(company.taxCode);
  if (company.domain) values.push(company.domain);
  for (const c of company.contactPoints) {
    if (c.type === "PHONE" || c.type === "EMAIL" || c.type === "ZALO") values.push(c.normalized);
  }
  const hits = await db.suppressionEntry.findMany({
    where: { value: { in: values } },
    take: 1,
  });
  if (hits.length > 0) return { suppressed: true, reason: hits[0].reason ?? "Có trong danh sách loại trừ" };
  return { suppressed: false };
}

/** Kiểm tra suppression theo giá trị đơn giản (phone/email/domain/id) */
export async function isSuppressedValue(value: string): Promise<boolean> {
  const hit = await db.suppressionEntry.findFirst({ where: { value }, select: { id: true } });
  return !!hit;
}
