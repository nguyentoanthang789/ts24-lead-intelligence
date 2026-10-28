// ============================================================
// Module 10 — Source Discovery: TỰ ĐỘNG DÒ ứng viên nguồn dữ liệu công khai
// Nguyên tắc: chỉ DÒ (robots.txt + khả năng truy cập HTTP) và ĐĂNG KÝ ứng viên
// vào Registry ở trạng thái "chờ xem xét" + TẮT — người dùng xác minh điều
// khoản sử dụng dữ liệu rồi mới bật thu thập.
// Không vượt CAPTCHA/đăng nhập/chống bot; lỗi mạng → ghi nhận trung thực,
// không giả định cho phép, không tạo dữ liệu thay thế.
// ============================================================

import { db } from "@/lib/db";
import { checkRobots } from "./sources/adapters";
import { audit } from "./compliance";

export type DiscoveryCandidate = {
  name: string;
  type: string; // OFFICIAL_REGISTRY | PUBLIC_DIRECTORY
  url: string;
  description: string;
};

/**
 * Danh mục ứng viên nguồn công khai (Việt Nam) — CHỈ LÀ ỨNG VIÊN.
 * Việc xuất hiện ở đây KHÔNG đồng nghĩa nguồn cho phép thu thập:
 * nguồn sau khi dò luôn chờ xem xét — phải bấm "Kiểm tra", xem điều khoản,
 * chuyển chính sách sang "Được phép" rồi mới bật.
 */
export const CANDIDATE_SOURCES: DiscoveryCandidate[] = [
  {
    name: "Cổng Đăng ký Kinh doanh quốc gia",
    type: "OFFICIAL_REGISTRY",
    url: "https://dangkykinhdoanh.gov.vn",
    description: "Cổng thông tin quốc gia về đăng ký doanh nghiệp — dữ liệu đăng ký doanh nghiệp chính thống",
  },
  {
    name: "Tổng cục Thống kê",
    type: "OFFICIAL_REGISTRY",
    url: "https://www.gso.gov.vn",
    description: "Dữ liệu thống kê theo ngành/tỉnh — phục vụ ước tính mẫu số bao phủ được tài liệu hóa",
  },
  {
    name: "Tra cứu Mã số thuế (masothue.com)",
    type: "PUBLIC_DIRECTORY",
    url: "https://masothue.com",
    description: "Tra cứu mã số thuế doanh nghiệp công khai",
  },
  {
    name: "Trang Vàng Việt Nam",
    type: "PUBLIC_DIRECTORY",
    url: "https://trangvangvietnam.com",
    description: "Danh bạ doanh nghiệp theo ngành nghề và địa phương",
  },
  {
    name: "Yellow Pages Việt Nam",
    type: "PUBLIC_DIRECTORY",
    url: "https://yellowpages.vn",
    description: "Danh bạ doanh nghiệp công khai theo ngành",
  },
  {
    name: "Thông tin doanh nghiệp (thongtindoanhnghiep.co)",
    type: "PUBLIC_DIRECTORY",
    url: "https://thongtindoanhnghiep.co",
    description: "Tra cứu thông tin doanh nghiệp công khai",
  },
  {
    name: "Danh Bạ Việt Nam — Sitemap hồ sơ công ty",
    type: "PUBLIC_DIRECTORY",
    url: "https://danhbavietnam.com/api/sitemaps/sitemap-companies-latest.xml",
    description: "Sitemap công khai danh sách hồ sơ doanh nghiệp (robots.txt cho phép, chỉ cấm /admin/) — cào từng trang hồ sơ có MST, địa chỉ, SĐT, website",
  },
  {
    name: "Danh Bạ Việt Nam — API tìm kiếm công ty",
    type: "OFFICIAL_API",
    url: "https://danhbavietnam.com/api/search?q=cong+ty",
    description: "API tìm kiếm công khai của Danh Bạ Việt Nam (JSON: MST, tên, tỉnh, trạng thái) — robots.txt cho phép /api/search",
  },
  {
    name: "EuroCham Việt Nam — Danh mục thành viên",
    type: "PUBLIC_DIRECTORY",
    url: "https://www.eurochamvn.org/members",
    description: "Danh mục thành viên EuroCham (doanh nghiệp tại Việt Nam, có email liên hệ công khai) — không có robots.txt (mặc định cho phép)",
  },
  {
    name: "Wikidata — doanh nghiệp Việt Nam (SPARQL)",
    type: "OFFICIAL_API",
    url: "https://query.wikidata.org/sparql",
    description: "Dữ liệu mở CC0 — truy vấn SPARQL doanh nghiệp Việt Nam; chịu giới hạn tần suất (429) nên giữ nhịp chậm",
  },
];

/** Chuẩn hóa URL về origin (scheme://host) — null nếu không phải http(s) */
export function normalizeSourceUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export type ProbeOutcome = {
  name: string;
  type: string;
  url: string;
  description: string;
  robotsStatus: "OK" | "RESTRICTED" | "UNKNOWN" | "CHECK_FAILED";
  robotsNote: string;
  reachable: boolean;
  httpStatus: number | null;
  alreadyRegistered: boolean;
  registered: boolean;
  note: string;
};

/** Dò 1 ứng viên: robots.txt + khả năng truy cập HTTP. fetchImpl inject để test không chạy mạng thật */
export async function probeCandidate(
  c: DiscoveryCandidate,
  fetchImpl: typeof fetch = fetch
): Promise<ProbeOutcome> {
  const robots = await checkRobots(c.url, fetchImpl);
  let reachable = false;
  let httpStatus: number | null = null;
  try {
    const res = await fetchImpl(c.url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    httpStatus = res.status;
    // 401/403/429 = nguồn chủ động từ chối truy cập tự động → coi như KHÔNG truy cập được (không né chống bot)
    reachable = res.status >= 200 && res.status < 400;
  } catch {
    reachable = false;
  }
  const notes: string[] = [];
  if (robots.status === "RESTRICTED") notes.push("robots.txt cấm thu thập — KHÔNG được bật nguồn này");
  else if (robots.status === "CHECK_FAILED") notes.push("chưa kiểm tra được robots.txt");
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    notes.push(`nguồn từ chối truy cập tự động (HTTP ${httpStatus}) — không né cơ chế chống bot`);
  } else if (!reachable) {
    notes.push("chưa truy cập được trang nguồn");
  }
  const note = notes.length
    ? notes.join("; ")
    : "đạt điều kiện dò — chờ người dùng xem xét điều khoản rồi mới bật thu thập";
  return {
    name: c.name, type: c.type, url: c.url, description: c.description,
    robotsStatus: robots.status, robotsNote: robots.note,
    reachable, httpStatus,
    alreadyRegistered: false, registered: false, note,
  };
}

/**
 * Dò danh sách ứng viên (song song — mỗi ứng viên tối đa 2 request: robots + trang chủ,
 * timeout 8s) rồi đăng ký nguồn mới vào Registry.
 * Nguồn mới luôn: accessPolicy=REVIEW_REQUIRED, isActive=false, needsReview=true.
 * Trùng URL hoặc tên với nguồn có sẵn → đánh dấu alreadyRegistered, không đụng vào.
 */
export async function probeAndRegister(opts: {
  fetchImpl?: typeof fetch;
  urls?: string[];
  includeCatalog?: boolean;
}): Promise<ProbeOutcome[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const list: DiscoveryCandidate[] = [];
  if (opts.includeCatalog !== false) list.push(...CANDIDATE_SOURCES);
  for (const raw of opts.urls ?? []) {
    const norm = normalizeSourceUrl(raw);
    if (!norm) continue;
    const host = new URL(norm).host;
    list.push({
      name: `URL tự dò — ${host}`,
      type: "PUBLIC_DIRECTORY",
      url: norm,
      description: "URL do người dùng cung cấp qua tính năng dò nguồn tự động",
    });
  }
  // Dò song song để không vượt quá ~15s kể cả khi nguồn chậm
  const probed = await Promise.all(list.map((c) => probeCandidate(c, fetchImpl)));
  // Đăng ký tuần tự để tránh race với unique constraint
  for (const o of probed) {
    const existing = await db.source.findFirst({
      where: { OR: [{ url: o.url }, { name: o.name }] },
      select: { id: true },
    });
    if (existing) {
      o.alreadyRegistered = true;
      continue;
    }
    await db.source.create({
      data: {
        name: o.name,
        type: o.type,
        url: o.url,
        allowedScope: o.description,
        accessPolicy: "REVIEW_REQUIRED",
        robotsStatus: o.robotsStatus,
        robotsNote: o.robotsNote,
        dataRightsNote: "Ứng viên do tính năng dò nguồn tự động thêm — bắt buộc xác minh điều khoản sử dụng dữ liệu trước khi bật",
        isActive: false,
        needsReview: true,
      },
    });
    o.registered = true;
  }
  await audit({
    actor: "system",
    action: "discovery.completed",
    entityType: "Source",
    detail: {
      probed: probed.length,
      registered: probed.filter((p) => p.registered).length,
      alreadyRegistered: probed.filter((p) => p.alreadyRegistered).length,
    },
  });
  return probed;
}
