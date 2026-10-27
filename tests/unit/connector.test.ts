// Test B (phần 1) — Collector Engine: robots parser, retry có giới hạn, adapter policy
// KHÔNG chạy mạng thật trong unit test — mọi fetch đều inject
import { describe, test, expect } from "bun:test";
import { checkRobots, withRetry, FileImportAdapter, WebPageAdapter } from "../../src/server/sources/adapters";

function fakeFetchFactory(responses: { status: number; body?: string }[], calls: string[] = []) {
  let i = 0;
  return (async (url: string | URL | Request): Promise<Response> => {
    calls.push(String(url));
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return new Response(r.body ?? "", { status: r.status });
  }) as typeof fetch;
}

describe("checkRobots — phân tích robots.txt", () => {
  test("robots.txt cấm toàn bộ → RESTRICTED", async () => {
    const fetchImpl = fakeFetchFactory([{ status: 200, body: "User-agent: *\nDisallow: /" }]);
    const r = await checkRobots("https://example.com/dir", fetchImpl);
    expect(r.status).toBe("RESTRICTED");
    expect(r.note).toContain("KHÔNG được bật");
  });

  test("robots.txt 404 → OK nhưng vẫn nhắc kiểm tra điều khoản", async () => {
    const fetchImpl = fakeFetchFactory([{ status: 404 }]);
    const r = await checkRobots("https://example.com", fetchImpl);
    expect(r.status).toBe("OK");
    expect(r.note).toContain("404");
  });

  test("robots.txt cho phép một phần → OK", async () => {
    const fetchImpl = fakeFetchFactory([{ status: 200, body: "User-agent: *\nDisallow: /private\n" }]);
    const r = await checkRobots("https://example.com", fetchImpl);
    expect(r.status).toBe("OK");
  });

  test("lỗi mạng → CHECK_FAILED (không giả định cho phép)", async () => {
    const fetchImpl = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const r = await checkRobots("https://example.com", fetchImpl);
    expect(r.status).toBe("CHECK_FAILED");
  });
});

describe("withRetry — retry có giới hạn", () => {
  test("thành công ngay khi lần đầu OK", async () => {
    let calls = 0;
    const r = await withRetry(async () => { calls++; return "ok"; }, { maxRetries: 3, baseDelayMs: 1 });
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  test("báo lỗi sau đúng maxRetries lần, không retry vô hạn", async () => {
    let calls = 0;
    let lastErr: unknown = null;
    try {
      await withRetry(async () => {
        calls++;
        throw new Error("fail");
      }, { maxRetries: 2, baseDelayMs: 1 });
    } catch (e) {
      lastErr = e;
    }
    expect(calls).toBe(3); // 1 lần đầu + 2 retry
    expect((lastErr as Error).message).toBe("fail");
  });
});

describe("Adapter policy — chỉ chạy khi đủ điều kiện", () => {
  test("FileImportAdapter chạy với nguồn file/manual, không cần ALLOWED network", () => {
    const a = new FileImportAdapter();
    expect(a.canRun("ALLOWED")).toBe(true);
    expect(a.canRun("REVIEW_REQUIRED")).toBe(true);
    expect(a.canRun("DISALLOWED")).toBe(false);
  });

  test("WebPageAdapter CHỈ chạy khi accessPolicy = ALLOWED", () => {
    const a = new WebPageAdapter();
    expect(a.canRun("ALLOWED")).toBe(true);
    expect(a.canRun("REVIEW_REQUIRED")).toBe(false);
    expect(a.canRun("DISALLOWED")).toBe(false);
  });

  test("WebPageAdapter từ chối khi robots RESTRICTED — dừng an toàn", async () => {
    const adapter = new WebPageAdapter();
    let networkCalls = 0;
    const fetchImpl = fakeFetchFactory([{ status: 200, body: "User-agent: *\nDisallow: /" }]);
    const wrappedFetch = (async (url: string | URL | Request) => {
      networkCalls++;
      return fetchImpl(url);
    }) as typeof fetch;
    await expect(
      adapter.collect({
        jobId: "j-test", sourceId: "s-test", sourceUrl: "https://example.com",
        rateLimitPerMin: 60, fetchImpl: wrappedFetch,
      })
    ).rejects.toThrow("dừng an toàn");
    // chỉ gọi robots.txt, không fetch trang chính
    expect(networkCalls).toBe(1);
    expect(String(networkCalls)).toBe("1");
  });
});
