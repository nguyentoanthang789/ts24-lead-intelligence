// Client API helper cho CRM frontend
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.ok) {
    throw new Error(json.error?.message ?? `Lỗi ${res.status}`);
  }
  return json.data;
}

export function fmtDate(d?: string | Date | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const TIER_LABELS: Record<string, string> = {
  HIGH: "Ưu tiên cao",
  NEEDS_VERIFICATION: "Cần xác minh",
  LOW: "Ưu tiên thấp",
  NOT_SUITABLE: "Không phù hợp",
};

export const OUTREACH_STATUS_LABELS: Record<string, string> = {
  NEW: "Chưa xử lý",
  CONTENT_READY: "Đã chuẩn bị nội dung",
  AWAITING_CONTACT: "Chờ tiếp cận",
  CONTACTED: "Đã liên hệ",
  REPLIED: "Đã phản hồi",
  INTERESTED: "Quan tâm",
  FOLLOW_UP: "Cần theo dõi",
  CONVERTED: "Đã chuyển đổi",
  NOT_SUITABLE: "Không phù hợp",
  DO_NOT_CONTACT: "Không tiếp tục liên hệ",
};

export const EVENT_LABELS: Record<string, string> = {
  DRAFT_CREATED: "Tạo bản nháp",
  CONTENT_COPIED: "Đã sao chép nội dung",
  ZALO_OPENED: "Mở Zalo Web",
  MARKED_CONTACTED: "Xác nhận đã liên hệ",
  REPLIED: "Khách phản hồi",
  INTERESTED: "Khách quan tâm",
  FOLLOW_UP: "Hẹn theo dõi",
  NOT_SUITABLE: "Không phù hợp",
  CONVERTED: "Chuyển đổi",
  DO_NOT_CONTACT: "Không liên hệ nữa",
  NOTE_ADDED: "Ghi chú",
  RETURNED_TO_VERIFICATION: "Trả về hàng xác minh",
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  OFFICIAL_API: "API chính thức",
  OFFICIAL_REGISTRY: "Sổ đăng ký chính thức",
  COMPANY_WEBSITE: "Website doanh nghiệp",
  PUBLIC_DIRECTORY: "Danh bạ công khai",
  USER_UPLOAD: "Người dùng cung cấp",
  MANUAL_ENTRY: "Nhập thủ công",
  FILE_IMPORT: "Tệp import",
};

export const PRODUCT_NAMES: Record<string, string> = {
  A: "Hóa đơn điện tử",
  B: "Kê khai thuế điện tử",
  C: "BHXH điện tử",
  D: "Số hóa tài liệu & lưu trữ",
  E: "Quản lý quy trình nghiệp vụ",
  F: "Chữ ký số & giao dịch điện tử",
};

export const ZALO_WEB_URL = "https://chat.zalo.me/";
