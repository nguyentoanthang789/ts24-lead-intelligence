// POST /api/import — upload CSV/XLSX → pipeline chuẩn hóa + khử trùng lặp + chấm điểm
// GET /api/import — lấy mẫu template import (CSV)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, handleError, requireMutationAuth, ApiError } from "@/server/http";
import { getScoringConfig } from "@/server/settings";
import { processRecords, ImportRow } from "@/server/import-pipeline";
import { parseCsv, csvToObjects } from "@/server/csv";
import { audit } from "@/server/compliance";

export const maxDuration = 60;

export async function GET() {
  const sample = [
    "ten_doanh_nghiep,ma_so_thue,dien_thoai,email,website,tinh,nganh_nghe,nam_thanh_lap,trang_thai",
    "Cong ty TNHH Minh Phat,0312345678,0901234567,info@minhphat.vn,https://minhphat.vn,TP. Hồ Chí Minh,thương mại phân phối,2021,Đang hoạt động",
  ].join("\n");
  return new Response("\uFEFF" + sample, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ts24-import-template.csv"',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    requireMutationAuth(req);
    const contentType = req.headers.get("content-type") ?? "";
    let rows: ImportRow[] = [];
    let sourceName = "Nhập tệp";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ApiError(400, "VALIDATION", "Thiếu tệp import");
      if (file.size > 10 * 1024 * 1024) throw new ApiError(400, "VALIDATION", "Tệp tối đa 10MB");
      sourceName = form.get("sourceName")?.toString() || file.name;
      const buffer = Buffer.from(await file.arrayBuffer());
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
      if (isXlsx) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "buffer" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        if (!sheet) throw new ApiError(400, "VALIDATION", "Tệp XLSX không có sheet nào");
        const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
        rows = csvToObjects(json.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [])));
      } else {
        // CSV
        const text = buffer.toString("utf-8");
        rows = csvToObjects(parseCsv(text));
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => null) as { rows?: ImportRow[]; sourceName?: string } | null;
      if (!body || !Array.isArray(body.rows)) throw new ApiError(400, "VALIDATION", "Body JSON cần { rows: [...] }");
      rows = body.rows;
      sourceName = body.sourceName || "JSON import";
    } else {
      throw new ApiError(400, "VALIDATION", "Content-Type phải là multipart/form-data (file) hoặc application/json (rows)");
    }

    if (rows.length === 0) throw new ApiError(400, "VALIDATION", "Không có dòng dữ liệu nào");
    if (rows.length > 5000) throw new ApiError(400, "VALIDATION", "Tối đa 5000 dòng mỗi lần import");

    // đảm bảo nguồn FILE_IMPORT tồn tại
    let source = await db.source.findFirst({ where: { name: sourceName } });
    if (!source) {
      source = await db.source.create({
        data: {
          name: sourceName,
          type: "FILE_IMPORT",
          accessPolicy: "ALLOWED",
          allowedScope: "Dữ liệu do người dùng cung cấp (tệp import)",
          isActive: true,
          needsReview: false,
          dataRightsNote: "Người dùng chịu trách nhiệm quyền sử dụng dữ liệu của tệp",
        },
      });
    }

    const config = await getScoringConfig();
    const result = await processRecords({ sourceId: source.id, rows, config });
    await audit({ action: "import.uploaded", entityType: "Source", entityId: source.id, detail: { fileName: sourceName, rowCount: rows.length } });
    return ok({ sourceId: source.id, ...result });
  } catch (err) {
    return handleError(err);
  }
}
