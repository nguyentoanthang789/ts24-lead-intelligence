// GET/POST /api/templates — quản lý mẫu nội dung
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth } from "@/server/http";
import { audit } from "@/server/compliance";

export async function GET() {
  try {
    const templates = await db.messageTemplate.findMany({ orderBy: { createdAt: "desc" } });
    return ok(templates);
  } catch (err) {
    return handleError(err);
  }
}

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  productCode: z.string().optional(),
  body: z.string().min(10).max(2000),
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    const template = await db.messageTemplate.create({
      data: { name: body.name, productCode: body.productCode ?? null, body: body.body, channel: "ZALO" },
    });
    await audit({ action: "template.created", entityType: "MessageTemplate", entityId: template.id, detail: { name: template.name } });
    return ok(template, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
