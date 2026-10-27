// GET/POST /api/campaigns — quản lý chiến dịch tiếp cận
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ok, handleError, parseBody, requireMutationAuth } from "@/server/http";
import { audit } from "@/server/compliance";

export async function GET() {
  try {
    const campaigns = await db.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { outreachTasks: true } } },
    });
    return ok(campaigns);
  } catch (err) {
    return handleError(err);
  }
}

const CreateSchema = z.object({
  name: z.string().min(2).max(120),
  productCode: z.string().optional(),
  goalNote: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const body = await parseBody(req, CreateSchema);
    const campaign = await db.campaign.create({ data: { name: body.name, productCode: body.productCode ?? null, goalNote: body.goalNote ?? null } });
    await audit({ action: "campaign.created", entityType: "Campaign", entityId: campaign.id, detail: { name: campaign.name, productCode: campaign.productCode } });
    return ok(campaign, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
