// POST /api/jobs/[id] — điều khiển job: pause | resume | cancel (dừng an toàn)
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError } from "@/server/http";
import { audit } from "@/server/compliance";

const ActionSchema = z.object({ action: z.enum(["pause", "resume", "cancel", "retry"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMutationAuth(req);
    const { id } = await params;
    const body = await parseBody(req, ActionSchema);
    const job = await db.collectionJob.findUnique({ where: { id } });
    if (!job) throw new ApiError(404, "NOT_FOUND", "Job không tồn tại");

    switch (body.action) {
      case "pause":
        await db.collectionJob.update({ where: { id }, data: { status: "PAUSED" } });
        break;
      case "cancel":
        await db.collectionJob.update({
          where: { id },
          data: {
            status: "CANCELLED", finishedAt: new Date(),
            checkpoint: JSON.stringify({ cancelledAt: new Date().toISOString() }),
            logText: `${job.logText ?? ""}[${new Date().toISOString()}] Người dùng dừng job một cách an toàn.\n`,
          },
        });
        break;
      case "resume": {
        if (job.status !== "PAUSED") throw new ApiError(400, "STATE", `Chỉ resume được job đang tạm dừng (hiện tại: ${job.status})`);
        await db.collectionJob.update({ where: { id }, data: { status: "PENDING", logText: `${job.logText ?? ""}[${new Date().toISOString()}] Resume từ checkpoint.\n` } });
        break;
      }
      case "retry": {
        if (!["FAILED", "CANCELLED"].includes(job.status)) throw new ApiError(400, "STATE", `Chỉ retry được job đã lỗi/đã hủy (hiện tại: ${job.status})`);
        await db.collectionJob.update({
          where: { id },
          data: { status: "PENDING", finishedAt: null, logText: `${job.logText ?? ""}[${new Date().toISOString()}] Retry theo yêu cầu người dùng.\n` },
        });
        break;
      }
    }
    await audit({ action: `job.${body.action}`, entityType: "CollectionJob", entityId: id });
    const updated = await db.collectionJob.findUnique({ where: { id } });
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}
