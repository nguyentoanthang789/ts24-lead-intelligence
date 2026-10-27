// ============================================================
// Module 13 — Auto-Import Inbox: bot TỰ NHẬP mọi tệp CSV/XLSX
// người vận hành thả vào upload/inbox (hoặc TS24_INBOX_DIR).
//
// Vì sao cần: phần lớn danh bạ doanh nghiệp VN chủ động chặn bot (HTTP 403)
// và hệ thống KHÔNG né cơ chế chống bot (đường viền tuân thủ) — nên kênh
// "cào mạng" chỉ chạy được với nguồn ĐÃ được phép. Inbox là kênh tự động
// LUÔN hoạt động: bot quét mỗi vòng pipeline, tự chuẩn hóa → khử trùng lặp
// → chấm điểm → lead xuất hiện trong hàng đợi mà không cần thao tác nào.
// Mỗi tệp được ghi CollectionJob + audit, nhập xong chuyển sang processed/,
// tệp lỗi chuyển sang failed/ — không mất dữ liệu, không nhập lại.
// ============================================================

import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { audit } from "./compliance";
import { getScoringConfig } from "./settings";
import { processRecords, ImportRow } from "./import-pipeline";

export const INBOX_DIR = process.env.TS24_INBOX_DIR || path.join(process.cwd(), "upload", "inbox");
export const PROCESSED_DIR = path.join(INBOX_DIR, "processed");
export const FAILED_DIR = path.join(INBOX_DIR, "failed");

const EXTENSIONS = [".csv", ".xlsx", ".xls"];
export const INBOX_SOURCE_NAME = "Hộp thư nhập tự động (upload/inbox)";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // đồng bộ với import upload: tối đa 10MB

export function ensureInboxDirs(): void {
  for (const d of [INBOX_DIR, PROCESSED_DIR, FAILED_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function listInboxFiles(): string[] {
  ensureInboxDirs();
  return fs
    .readdirSync(INBOX_DIR)
    .filter((f) => EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map((f) => path.join(INBOX_DIR, f))
    .filter((p) => fs.statSync(p).isFile());
}

/** Parse 1 tệp inbox thành ImportRow[] — tái dùng đúng bộ parse của import upload */
export async function parseInboxFile(filePath: string): Promise<ImportRow[]> {
  const { parseCsv, csvToObjects } = await import("./csv");
  const size = fs.statSync(filePath).size;
  if (size > MAX_FILE_BYTES) throw new Error(`Tệp ${path.basename(filePath)} vượt 10MB — hãy tách nhỏ`);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) throw new Error("Tệp XLSX không có sheet nào");
    const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false });
    return csvToObjects(json.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "")) : [])));
  }
  return csvToObjects(parseCsv(buffer.toString("utf-8")));
}

async function getOrCreateInboxSource() {
  let source = await db.source.findFirst({ where: { name: INBOX_SOURCE_NAME } });
  if (!source) {
    source = await db.source.create({
      data: {
        name: INBOX_SOURCE_NAME,
        type: "FILE_IMPORT",
        accessPolicy: "ALLOWED",
        allowedScope: "Dữ liệu do người vận hành thả vào hộp thư upload/inbox",
        isActive: true,
        needsReview: false,
        dataRightsNote: "Người vận hành chịu trách nhiệm quyền sử dụng dữ liệu của tệp thả vào inbox",
      },
    });
    await audit({ action: "inbox.source_created", entityType: "Source", entityId: source.id, detail: { name: INBOX_SOURCE_NAME } });
  }
  return source;
}

export type InboxFileResult = {
  file: string;
  status: "IMPORTED" | "EMPTY" | "FAILED";
  rows?: number;
  valid?: number;
  created?: number;
  merged?: number;
  duplicates?: number;
  error?: string;
};

export type InboxScanResult = {
  filesProcessed: number;
  rowsImported: number;
  createdCompanies: number;
  mergedCompanies: number;
  duplicateRecords: number;
  failedFiles: number;
  details: InboxFileResult[];
};

/** Nhập 1 tệp: parse → processRecords (chuẩn hóa + khử trùng lặp + chấm điểm) → chuyển tệp đi */
export async function processInboxFile(filePath: string): Promise<InboxFileResult> {
  const fileName = path.basename(filePath);
  const source = await getOrCreateInboxSource();
  const job = await db.collectionJob.create({ data: { sourceId: source.id, status: "PENDING" } });
  try {
    const rows = await parseInboxFile(filePath);
    if (rows.length === 0) {
      await db.collectionJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", finishedAt: new Date(), discoveredCount: 0, logText: `Tệp ${fileName}: không có dòng dữ liệu nào.\n` },
      });
      moveTo(filePath, PROCESSED_DIR);
      return { file: fileName, status: "EMPTY", rows: 0 };
    }
    if (rows.length > 5000) throw new Error("Tối đa 5000 dòng mỗi tệp — hãy tách nhỏ");
    const config = await getScoringConfig();
    await db.collectionJob.update({ where: { id: job.id }, data: { status: "RUNNING", startedAt: new Date() } });
    const result = await processRecords({ sourceId: source.id, rows, config, jobId: job.id });
    await db.collectionJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED", finishedAt: new Date(), discoveredCount: result.totalRows,
        logText: `Tệp ${fileName}: ${result.totalRows} dòng — hợp lệ ${result.validRows}, tạo ${result.createdCompanies}, hợp nhất ${result.mergedCompanies}, trùng ${result.duplicateRecords}, lỗi ${result.errorRows}.\n`,
      },
    });
    await audit({
      action: "inbox.file_imported", entityType: "CollectionJob", entityId: job.id,
      detail: { file: fileName, rows: result.totalRows, valid: result.validRows, created: result.createdCompanies, merged: result.mergedCompanies, duplicates: result.duplicateRecords, errors: result.errorRows },
    });
    moveTo(filePath, PROCESSED_DIR);
    return {
      file: fileName, status: "IMPORTED", rows: result.totalRows, valid: result.validRows,
      created: result.createdCompanies, merged: result.mergedCompanies, duplicates: result.duplicateRecords,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.collectionJob.update({
      where: { id: job.id },
      data: { status: "FAILED", finishedAt: new Date(), errorCount: 1, logText: `Tệp ${fileName} LỖI: ${msg}\n` },
    });
    moveTo(filePath, FAILED_DIR);
    return { file: fileName, status: "FAILED", error: msg };
  }
}

function moveTo(filePath: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let target = path.join(targetDir, `${stamp}_${path.basename(filePath)}`);
  // tên đã tồn tại (2 tệp trong cùng giây) → thêm đuôi tăng dần
  let n = 1;
  while (fs.existsSync(target)) {
    target = path.join(targetDir, `${stamp}_${n++}_${path.basename(filePath)}`);
  }
  fs.renameSync(filePath, target);
}

/** Quét toàn bộ tệp trong inbox và nhập — giới hạn maxFiles mỗi lần để không ép pipeline */
export async function scanInbox(opts?: { maxFiles?: number }): Promise<InboxScanResult> {
  const maxFiles = Math.max(1, opts?.maxFiles ?? 10);
  const files = listInboxFiles().slice(0, maxFiles);
  const result: InboxScanResult = {
    filesProcessed: 0, rowsImported: 0, createdCompanies: 0, mergedCompanies: 0,
    duplicateRecords: 0, failedFiles: 0, details: [],
  };
  for (const f of files) {
    const r = await processInboxFile(f);
    result.filesProcessed++;
    result.details.push(r);
    if (r.status === "IMPORTED") {
      result.rowsImported += r.rows ?? 0;
      result.createdCompanies += r.created ?? 0;
      result.mergedCompanies += r.merged ?? 0;
      result.duplicateRecords += r.duplicates ?? 0;
    } else if (r.status === "FAILED") {
      result.failedFiles++;
    }
  }
  return result;
}
