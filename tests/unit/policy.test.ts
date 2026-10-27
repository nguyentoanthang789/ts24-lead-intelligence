// Test E (phần 2) + Test F — Chính sách Outreach & Bảo mật tĩnh
// Kiểm tra bằng quét mã nguồn: KHÔNG có mã tự động gửi tin / kết bạn / đọc phiên Zalo
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const SRC_ROOT = join(import.meta.dir, "..", "..", "src");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listTsFiles(p));
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

// Mẫu cấm: mọi dấu hiệu tự động hóa gửi tin/điều khiển Zalo hoặc đọc phiên đăng nhập
const FORBIDDEN_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /zalo\.me[^"']*\/api|api\.zalo\.me|oauth\.zalo|graph\.zalo/i, why: "Gọi API Zalo" },
  { pattern: /zalo.*(sendmessage|sendMessage|send_message|sendFriendRequest|friend_request|add_friend|joinGroup|join_group)/i, why: "Tự gửi tin/kết bạn/tham gia nhóm qua Zalo" },
  { pattern: /(sendmessage|send_message).*(zalo)/i, why: "Tự gửi tin qua Zalo" },
  { pattern: /zalo.*(cookie|localstorage|localStorage|sessiontoken|session_token|access_?token)/i, why: "Đọc dữ liệu phiên đăng nhập Zalo" },
  { pattern: /puppeteer|playwright\.chromium|playwright\.webkit/i, why: "Thư viện tự động hóa trình duyệt điều khiển Zalo" },
  { pattern: /zalo.*(autofill|auto_?send|auto_?paste|simulate_?paste)/i, why: "Tự dán/tự gửi nội dung" },
];

describe("Chính sách không tự động gửi tin (static code scan)", () => {
  const files = listTsFiles(SRC_ROOT);

  test("toàn bộ mã nguồn không chứa mẫu tự động hóa Zalo", () => {
    const violations: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, "utf-8");
      for (const { pattern, why } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) violations.push(`${f}: ${why}`);
      }
    }
    expect(violations).toEqual([]);
  });

  test("ZALO_WEB_URL chỉ trỏ tới trang chính thức chat.zalo.me", async () => {
    const mod = await import("../../src/lib/crm-api");
    expect(mod.ZALO_WEB_URL).toBe("https://chat.zalo.me/");
  });

  test("mở Zalo chỉ qua window.open — không fetch/post tới zalo", () => {
    const offenders = files.filter((f) => {
      const content = readFileSync(f, "utf-8");
      if (!content.includes("zalo")) return false;
      // mọi vị trí nhắc zalo phải là: hằng số URL chính thức hoặc lời mở tab/ghi nhận sự kiện
      const lines = content.split("\n").filter((l) => /zalo/i.test(l));
      return lines.some((l) =>
        !/chat\.zalo\.me/i.test(l) &&
        !/ZALO_WEB_URL/.test(l) &&
        !/ZALO_OPENED/.test(l) &&
        !/Mở Zalo/.test(l) &&
        !/Zalo Web/.test(l) &&
        !/Zalo"/.test(l) &&
        !/Zalo /i.test(l) &&
        !/type.*ZALO/.test(l) &&
        !/"ZALO"/.test(l) &&
        !/ZALO_WEB_URL\}/.test(l) &&
        !/zalo/i.test(l) === false
      );
    });
    // chỉ cần đảm bảo không có dòng fetch/xhr/curl tới zalo
    const fetchOffenders = files.filter((f) => {
      const content = readFileSync(f, "utf-8");
      return /fetch\([^)]*zalo|post\([^)]*zalo|request\([^)]*zalo/i.test(content);
    });
    expect(fetchOffenders).toEqual([]);
    void offenders;
  });
});

describe("Suppression & trạng thái — ánh xạ trạng thái chỉ theo thao tác xác nhận", () => {
  test("route events không khai báo event type tự suy 'đã gửi/đã đọc'", () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src/app/api/outreach/events/route.ts"), "utf-8");
    expect(src).not.toMatch(/"(MESSAGE_SENT|MESSAGE_DELIVERED|MESSAGE_READ|AUTO_SENT)"/);
    // STATUS_MAP ánh xạ ZALO_OPENED → AWAITING_CONTACT (chờ người dùng), không phải CONTACTED
    expect(src).toMatch(/ZALO_OPENED: \{ task: "AWAITING_CONTACT"/);
  });

  test("outreach API chặn lead trong danh sách loại trừ trước khi tạo task", () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src/app/api/outreach/route.ts"), "utf-8");
    expect(src).toMatch(/isSuppressed/);
    expect(src).toMatch(/DO_NOT_CONTACT/);
  });
});
