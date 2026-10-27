// API helpers: response envelope, pagination, token guard, error handling
import { NextRequest, NextResponse } from "next/server";
import { ZodSchema } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(status: number, code: string, message: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

export function handleError(err: unknown) {
  if (err instanceof ApiError) return fail(err.status, err.code, err.message);
  console.error("[api-error]", err instanceof Error ? err.message : err);
  // không lộ stack / dữ liệu nhạy cảm ra ngoài
  return fail(500, "INTERNAL", "Lỗi hệ thống, vui lòng thử lại sau");
}

export function getPagination(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(sp.get("pageSize") ?? "20", 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Guard thao tác ghi: khi biến môi trường CRM_API_TOKEN được đặt,
 * mọi mutation phải có header x-api-token khớp. MVP mặc định single-operator.
 */
export function requireMutationAuth(req: NextRequest) {
  const token = process.env.CRM_API_TOKEN;
  if (!token) return; // chế độ demo single-operator
  const provided = req.headers.get("x-api-token");
  if (provided !== token) {
    throw new ApiError(401, "UNAUTHORIZED", "Thiếu hoặc sai x-api-token");
  }
}

export async function parseBody<T>(req: NextRequest, schema: ZodSchema<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ApiError(400, "BAD_JSON", "Body phải là JSON hợp lệ");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, "VALIDATION", `${first.path.join(".") || "body"}: ${first.message}`);
  }
  return parsed.data;
}

export function parseQuery<T>(req: NextRequest, schema: ZodSchema<T>): T {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  const parsed = schema.safeParse(obj);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, "VALIDATION", `${first.path.join(".") || "query"}: ${first.message}`);
  }
  return parsed.data;
}
