// POST /api/outreach/events — ghi nhận sự kiện đã XÁC NHẬN bởi thao tác người dùng
// KHÔNG tự suy ra đã gửi/đã đọc chỉ vì người dùng mở Zalo Web hoặc sao chép nội dung
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { audit } from "@/server/compliance";

const EVENT_TYPES = [
  "CONTENT_COPIED", "ZALO_OPENED", "MARKED_CONTACTED", "REPLIED", "INTERESTED",
  "FOLLOW_UP", "NOT_SUITABLE", "CONVERTED", "DO_NOT_CONTACT",
  "NOTE_ADDED", "RETURNED_TO_VERIFICATION",
] as const;

const BodySchema = z.object({
  companyId: z.string().min(1),
  taskId: z.string().optional(),
  type: z.enum(EVENT_TYPES),
  note: z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(), // cho FOLLOW_UP: lịch nhắc theo dõi
  editedContent: z.string().max(4000).optional(), // nội dung người dùng đã duyệt
});

// Ánh xạ event → trạng thái OutreachTask + Company.outreachStatus
const STATUS_MAP: Record<(typeof EVENT_TYPES)[number], { task: string; company: string } | null> = {
  CONTENT_COPIED: { task: "CONTENT_READY", company: "CONTENT_READY" },
  ZALO_OPENED: { task: "AWAITING_CONTACT", company: "AWAITING_CONTACT" },
  MARKED_CONTACTED: { task: "CONTACTED", company: "CONTACTED" },
  REPLIED: { task: "REPLIED", company: "REPLIED" },
  INTERESTED: { task: "INTERESTED", company: "INTERESTED" },
  FOLLOW_UP: { task: "FOLLOW_UP", company: "FOLLOW_UP" },
  NOT_SUITABLE: { task: "NOT_SUITABLE", company: "NOT_SUITABLE" },
  CONVERTED: { task: "CONVERTED", company: "CONVERTED" },
  DO_NOT_CONTACT: { task: "DO_NOT_CONTACT", company: "DO_NOT_CONTACT" },
  NOTE_ADDED: null,
  RETURNED_TO_VERIFICATION: { task: "NEW", company: "AWAITING_CONTACT" },
};

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, BodySchema);
    const company = await db.company.findUnique({ where: { id: body.companyId } });
    if (!company) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy doanh nghiệp");

    let task = body.taskId
      ? await db.outreachTask.findUnique({ where: { id: body.taskId } })
      : await db.outreachTask.findFirst({
          where: { companyId: body.companyId, status: { in: ["NEW", "CONTENT_READY", "AWAITING_CONTACT", "CONTACTED", "REPLIED", "INTERESTED", "FOLLOW_UP"] } },
          orderBy: { updatedAt: "desc" },
        });

    const mapping = STATUS_MAP[body.type];

    if (body.type === "NOTE_ADDED" && !body.note) {
      throw new ApiError(400, "VALIDATION", "NOTE_ADDED cần nội dung ghi chú");
    }

    // Lưu nội dung người dùng đã duyệt (nếu có) — nội dung gửi đi do người dùng kiểm soát
    if (task && body.editedContent) {
      await db.outreachTask.update({ where: { id: task.id }, data: { draftContent: body.editedContent } });
    }

    // tạo sự kiện — dữ liệu tương tác chỉ dựa trên thao tác xác nhận
    const event = await db.outreachEvent.create({
      data: {
        companyId: body.companyId,
        taskId: task?.id ?? null,
        type: body.type,
        note: body.note ?? null,
        actor: "operator",
      },
    });

    if (task && mapping) {
      await db.outreachTask.update({
        where: { id: task.id },
        data: {
          status: mapping.task,
          lastEventAt: new Date(),
          ...(body.type === "FOLLOW_UP" && body.scheduledAt ? { scheduledAt: new Date(body.scheduledAt) } : {}),
        },
      });
    }
    if (mapping) {
      await db.company.update({
        where: { id: body.companyId },
        data: { outreachStatus: mapping.company },
      });
    }

    await audit({ action: `outreach.${body.type.toLowerCase()}`, entityType: "Company", entityId: body.companyId, detail: { taskId: task?.id ?? null, hasNote: !!body.note } });

    return ok({ event, taskStatus: mapping?.task ?? null });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/outreach/events?companyId=... — lịch sử tương tác
export async function GET(req: NextRequest) {
  try {
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) throw new ApiError(400, "VALIDATION", "Thiếu companyId");
    const events = await db.outreachEvent.findMany({
      where: { companyId },
      orderBy: { occurredAt: "desc" },
      take: 100,
    });
    return ok(events);
  } catch (err) {
    return handleError(err);
  }
}
