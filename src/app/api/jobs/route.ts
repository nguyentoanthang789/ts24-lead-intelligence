// GET /api/jobs — danh sách job thu thập | POST — tạo job mới cho nguồn
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth, ApiError, getPagination } from "@/server/http";
import { runCollectionJob } from "@/server/sources/adapters";
import { getScoringConfig } from "@/server/settings";
import { audit } from "@/server/compliance";

export async function GET(req: NextRequest) {
  try {
    const { skip, take, page, pageSize } = getPagination(req);
    const [total, jobs] = await Promise.all([
      db.collectionJob.count(),
      db.collectionJob.findMany({
        orderBy: { createdAt: "desc" },
        skip, take,
        include: { source: { select: { id: true, name: true, type: true } } },
      }),
    ]);
    return ok({ items: jobs, total, page, pageSize });
  } catch (err) {
    return handleError(err);
  }
}

const CreateSchema = z.object({ sourceId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    const source = await db.source.findUnique({ where: { id: body.sourceId } });
    if (!source) throw new ApiError(404, "NOT_FOUND", "Nguồn không tồn tại");
    if (!source.isActive) {
      throw new ApiError(400, "POLICY", "Nguồn chưa được bật — hãy kiểm tra truy cập và xác minh quyền sử dụng dữ liệu trước");
    }
    const job = await db.collectionJob.create({
      data: { sourceId: source.id, status: "PENDING" },
    });
    await audit({ action: "job.created", entityType: "CollectionJob", entityId: job.id, detail: { sourceName: source.name } });

    // chạy job bất đồng bộ — API trả ngay để UI poll trạng thái
    const config = await getScoringConfig();
    void runCollectionJob(job.id, config).catch(() => undefined);

    return ok(job, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
