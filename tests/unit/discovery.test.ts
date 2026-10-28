// Test — Source Discovery: danh mục ứng viên, chuẩn hóa URL, dò robots + HTTP (fetch inject)
// KHÔNG chạy mạng thật trong unit test. Phần đăng ký DB nằm ngoài phạm vi unit (cần DB).
import { describe, test, expect } from "bun:test";
import { CANDIDATE_SOURCES, normalizeSourceUrl, probeCandidate } from "../../src/server/discovery";

/** Fake fetch phân vai theo URL: robots.txt hoặc trang chủ */
function fetchByRole(responses: { robots?: { status: number; body?: string }; page?: { status: number } | "throw" }): typeof fetch {
  return (async (url: string | URL | Request): Promise<Response> => {
    const u = String(url);
    if (u.includes("robots.txt")) {
      if (!responses.robots) throw new Error("network down");
      return new Response(responses.robots.body ?? "", { status: responses.robots.status });
    }
    if (responses.page === "throw") throw new Error("network down");
    return new Response("", { status: responses.page?.status ?? 200 });
  }) as typeof fetch;
}

const candidate = {
  name: "Nguồn kiểm thử",
  type: "PUBLIC_DIRECTORY",
  url: "https://example.com",
  description: "nguồn giả lập cho unit test",
};

describe("Source Discovery — danh mục ứng viên", () => {
  test("danh mục không rỗng, URL hợp lệ, không trùng lặp", () => {
    const urls = CANDIDATE_SOURCES.map((c) => c.url);
    expect(urls.length).toBeGreaterThanOrEqual(5);
    expect(new Set(urls).size).toBe(urls.length);
    for (const c of CANDIDATE_SOURCES) {
      expect(normalizeSourceUrl(c.url)).not.toBeNull();
      expect(c.name.length).toBeGreaterThan(3);
      expect(c.description.length).toBeGreaterThan(10);
      expect(["OFFICIAL_REGISTRY", "PUBLIC_DIRECTORY", "OFFICIAL_API"]).toContain(c.type);
    }
  });

  test("normalizeSourceUrl — cắt path/query, hạ hoa thường host, chặn non-http", () => {
    expect(normalizeSourceUrl("https://example.com/path?q=1")).toBe("https://example.com");
    expect(normalizeSourceUrl("  http://Example.COM ")).toBe("http://example.com");
    expect(normalizeSourceUrl("ftp://example.com")).toBeNull();
    expect(normalizeSourceUrl("khong-phai-url")).toBeNull();
    expect(normalizeSourceUrl("")).toBeNull();
  });
});

describe("probeCandidate — dò robots + khả năng truy cập (fetch inject)", () => {
  test("robots OK + HTTP 200 → reachable, đạt điều kiện dò", async () => {
    const o = await probeCandidate(
      candidate,
      fetchByRole({ robots: { status: 200, body: "User-agent: *\nAllow: /" }, page: { status: 200 } })
    );
    expect(o.reachable).toBe(true);
    expect(o.robotsStatus).toBe("OK");
    expect(o.note).toContain("đạt điều kiện dò");
    expect(o.registered).toBe(false); // probe không tự đăng ký
  });

  test("robots cấm toàn bộ → RESTRICTED + cảnh báo KHÔNG được bật", async () => {
    const o = await probeCandidate(
      candidate,
      fetchByRole({ robots: { status: 200, body: "User-agent: *\nDisallow: /" }, page: { status: 200 } })
    );
    expect(o.robotsStatus).toBe("RESTRICTED");
    expect(o.note).toContain("KHÔNG được bật");
  });

  test("HTTP 403 → nguồn từ chối truy cập tự động, không né chống bot", async () => {
    const o = await probeCandidate(
      candidate,
      fetchByRole({ robots: { status: 200, body: "" }, page: { status: 403 } })
    );
    expect(o.reachable).toBe(false);
    expect(o.note).toContain("403");
    expect(o.note).toContain("không né");
  });

  test("mạng lỗi toàn bộ → CHECK_FAILED + không truy cập được, không giả định cho phép", async () => {
    const o = await probeCandidate(candidate, fetchByRole({ page: "throw" }));
    expect(o.robotsStatus).toBe("CHECK_FAILED");
    expect(o.reachable).toBe(false);
  });

  test("HTTP 429 (rate limit) → coi như không truy cập được", async () => {
    const o = await probeCandidate(
      candidate,
      fetchByRole({ robots: { status: 200, body: "" }, page: { status: 429 } })
    );
    expect(o.reachable).toBe(false);
    expect(o.note).toContain("429");
  });
});
