// GET/POST /api/sources — Source Registry
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth } from "@/server/http";
import { audit } from "@/server/compliance";

export async function GET() {
  try {
    const sources = await db.source.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { sourceRecords: true, collectionJobs: true } } },
    });
    return ok(sources);
  } catch (err) {
    return handleError(err);
  }
}

const SOURCE_TYPES = ["OFFICIAL_API", "OFFICIAL_REGISTRY", "COMPANY_WEBSITE", "PUBLIC_DIRECTORY", "USER_UPLOAD", "MANUAL_ENTRY", "FILE_IMPORT"] as const;
const ACCESS_POLICIES = ["ALLOWED", "REVIEW_REQUIRED", "DISALLOWED"] as const;

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(SOURCE_TYPES),
  url: z.string().url().optional().or(z.literal("")),
  allowedScope: z.string().optional(),
  accessPolicy: z.enum(ACCESS_POLICIES).default("REVIEW_REQUIRED"),
  rateLimitPerMin: z.coerce.number().int().min(1).max(60).default(10),
  dataRightsNote: z.string().optional(),
  retentionDays: z.coerce.number().int().min(30).max(3650).default(365),
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    const exists = await db.source.findUnique({ where: { name: body.name } });
    if (exists) return ok({ duplicate: true, id: exists.id }, { status: 200 });
    // Nguồn mạng KHÔNG được bật sẵn — phải qua kiểm tra truy cập trước
    const needsNetworkCheck = ["OFFICIAL_API", "OFFICIAL_REGISTRY", "COMPANY_WEBSITE", "PUBLIC_DIRECTORY"].includes(body.type);
    const source = await db.source.create({
      data: {
        name: body.name,
        type: body.type,
        url: body.url || null,
        allowedScope: body.allowedScope ?? null,
        accessPolicy: body.accessPolicy,
        rateLimitPerMin: body.rateLimitPerMin,
        dataRightsNote: body.dataRightsNote ?? null,
        retentionDays: body.retentionDays,
        isActive: false, // luôn tắt ban đầu — quản trị bật sau khi xem xét
        needsReview: needsNetworkCheck ? true : body.accessPolicy !== "ALLOWED",
        robotsStatus: null,
      },
    });
    await audit({ action: "source.created", entityType: "Source", entityId: source.id, detail: { type: source.type, accessPolicy: source.accessPolicy, hasUrl: !!source.url } });
    return ok(source, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
