// Test E (phần 1) — Template rendering: biến thiếu KHÔNG bị thay bằng nội dung bịa
import { describe, test, expect } from "bun:test";
import { renderTemplate, extractVariables, buildVerifiedContext } from "../../src/server/templates";

describe("Template render", () => {
  const body = "Chào {company_name},\nTôi là {sender_name} — TS24, thấy đơn vị mình {verified_business_context}.\nVề {product_name}...";

  test("đủ biến → thay đúng", () => {
    const r = renderTemplate(body, {
      company_name: "Cong ty A",
      sender_name: "Nguyễn Văn B",
      verified_business_context: "hoạt động trong lĩnh vực thương mại",
      product_name: "Hóa đơn điện tử",
    });
    expect(r.content).toContain("Chào Cong ty A");
    expect(r.content).toContain("Nguyễn Văn B");
    expect(r.missingVariables).toHaveLength(0);
    expect(r.content).not.toContain("{");
  });

  test("thiếu biến → báo missingVariables, KHÔNG bịa dữ liệu", () => {
    const r = renderTemplate(body, { company_name: "Cong ty A" });
    expect(r.missingVariables).toContain("sender_name");
    expect(r.missingVariables).toContain("verified_business_context");
    expect(r.missingVariables).toContain("product_name");
    // dòng chứa biến thiếu bị rút gọn, không sinh tên/ngữ cảnh giả
    expect(r.content).not.toContain("undefined");
    expect(r.content).not.toContain("null");
  });

  test("extractVariables liệt kê đúng biến", () => {
    expect(extractVariables(body)).toEqual([
      "company_name", "sender_name", "verified_business_context", "product_name",
    ]);
  });

  test("dọn khoảng trắng thừa sau khi bỏ biến", () => {
    const r = renderTemplate("Xin chào {company_name} {sender_name}!", { company_name: "A" });
    expect(r.content).toBe("Xin chào A!");
  });
});

describe("buildVerifiedContext — chỉ dùng bằng chứng thật", () => {
  test("không có bằng chứng → null (không tạo ngữ cảnh giả)", () => {
    expect(buildVerifiedContext([], null, null)).toBeNull();
  });

  test("có sector + bằng chứng → ghép từ dữ liệu thực", () => {
    const ctx = buildVerifiedContext(
      [{ kind: "HIRING", summary: "Tin tuyển dụng 20 nhân viên", confidence: "HIGH" }],
      "thuong mai",
      "TP. Hồ Chí Minh"
    );
    expect(ctx).toContain("thuong mai");
    expect(ctx).toContain("Tin tuyển dụng 20 nhân viên");
  });

  test("bằng chứng LOW confidence không được dùng làm ngữ cảnh mạnh", () => {
    const ctx = buildVerifiedContext(
      [{ kind: "OTHER", summary: "conjecture", confidence: "LOW" }],
      null,
      null
    );
    expect(ctx).toBeNull();
  });
});
