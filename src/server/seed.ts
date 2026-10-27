// ============================================================
// Catalog seed — CHỈ nạp danh mục cấu hình (sản phẩm, mẫu tin nhắn, nguồn)
// KHÔNG TẠO LEAD GIẢ. Toàn bộ lead demo đã bị loại bỏ theo yêu cầu:
// hệ thống chỉ làm việc với lead THẬT từ nguồn thật/tệp người vận hành.
// Gồm cả purgeDemoData() để xóa sạch lead demo còn sót lại từ phiên bản cũ.
// ============================================================

import { db } from "@/lib/db";
import { audit } from "./compliance";

export const PRODUCT_SEED = [
  { code: "A", name: "Hóa đơn điện tử", description: "Phát hành, xử lý hóa đơn điện tử cho bán hàng, dịch vụ, phân phối, bán lẻ, chuỗi cửa hàng.", sortOrder: 1 },
  { code: "B", name: "Kê khai thuế điện tử", description: "Chuẩn hóa nghiệp vụ kế toán và kê khai thuế cho doanh nghiệp mới hoạt động hoặc đang vận hành.", sortOrder: 2 },
  { code: "C", name: "BHXH điện tử", description: "Quản lý lao động, tham gia và kê khai BHXH điện tử cho doanh nghiệp có nhân sự, tuyển dụng.", sortOrder: 3 },
  { code: "D", name: "Số hóa tài liệu và lưu trữ", description: "Số hóa, lưu trữ, tra cứu hồ sơ nghiệp vụ cho đơn vị nhiều phòng ban, chi nhánh.", sortOrder: 4 },
  { code: "E", name: "Quản lý quy trình nghiệp vụ", description: "Chuẩn hóa luồng phê duyệt, phối hợp nhiều đơn vị vận hành trong nội bộ.", sortOrder: 5 },
  { code: "F", name: "Chữ ký số và giao dịch điện tử", description: "Ký điện tử và nghiệp vụ giao dịch điện tử cho doanh nghiệp theo loại hình phù hợp.", sortOrder: 6 },
];

export const TEMPLATE_SEED = [
  {
    name: "Lời chào hóa đơn điện tử (ngắn gọn)",
    productCode: "A",
    body: "Chào anh/chị {company_name},\n\nTôi là {sender_name}, đại diện TS24. Em thấy đơn vị mình {verified_business_context}.\n\nTS24 đang hỗ trợ các doanh nghiệp trong lĩnh vực {business_sector} về {product_name} — phát hành và xử lý hóa đơn điện tử thuận tiện hơn cho hoạt động bán hàng hiện tại.\n\nNếu anh/chị quan tâm, em xin phép gửi thêm thông tin ngắn gọn. Em cảm ơn anh/chị đã đọc tin!",
  },
  {
    name: "Lời chào kê khai thuế (doanh nghiệp mới)",
    productCode: "B",
    body: "Chào anh/chị {company_name},\n\nEm là {sender_name} từ TS24. Qua thông tin công khai, em thấy đơn vị mình {verified_business_context}.\n\nVới doanh nghiệp mới thành lập, khâu {product_name} thường phát sinh ngay từ các kỳ đầu. TS24 hỗ trợ nhiều doanh nghiệp ngành {business_sector} làm phần này gọn gàng, đúng hạn.\n\nAnh/chị cho em xin vài phút trao đổi được không ạ? Em cảm ơn!",
  },
  {
    name: "Lời chào tổng hợp (mọi sản phẩm)",
    productCode: null,
    body: "Chào anh/chị {company_name},\n\nEm là {sender_name} — TS24. Đơn vị mình {verified_business_context}, nên em xin phép giới thiệu ngắn gọn về {product_name} mà TS24 đang hỗ trợ cho các doanh nghiệp như đơn vị mình.\n\nNếu anh/chị thấy nội dung này chưa phù hợp, em mong anh/chị cho em biết để em không làm phiền thêm ạ. Em cảm ơn!",
  },
];

export const SOURCE_SEED = [
  {
    name: "Tệp import nội bộ",
    type: "FILE_IMPORT",
    accessPolicy: "ALLOWED",
    allowedScope: "Dữ liệu do người dùng cung cấp qua tệp CSV/XLSX",
    isActive: true,
    needsReview: false,
    dataRightsNote: "Người dùng chịu trách nhiệm quyền sử dụng dữ liệu tệp",
  },
  {
    name: "Nhập thủ công",
    type: "MANUAL_ENTRY",
    accessPolicy: "ALLOWED",
    allowedScope: "Doanh nghiệp do nhân viên nhập tay",
    isActive: true,
    needsReview: false,
    dataRightsNote: "Dữ liệu nhập nội bộ",
  },
];

/**
 * Nạp DANH MỤC cấu hình (sản phẩm + mẫu tin nhắn + nguồn gốc).
 * Idempotent. KHÔNG tạo công ty/lead nào — lead chỉ đến từ nguồn thật.
 */
export async function seedCatalog() {
  for (const p of PRODUCT_SEED) {
    await db.product.upsert({ where: { code: p.code }, create: p, update: p });
  }
  const existingTemplates = await db.messageTemplate.count();
  if (existingTemplates === 0) {
    for (const t of TEMPLATE_SEED) {
      await db.messageTemplate.create({ data: { ...t, productCode: t.productCode ?? undefined } });
    }
  }
  for (const s of SOURCE_SEED) {
    await db.source.upsert({ where: { name: s.name }, create: s, update: {} });
  }
  await audit({ action: "catalog.seeded", entityType: "System", detail: { products: PRODUCT_SEED.length, sources: SOURCE_SEED.length } });
}

export type PurgeDemoResult = {
  deletedCompanies: number;
  deletedSegments: number;
  deletedSuppressions: number;
  deletedEvidences: number;
};

/**
 * XÓA SẠCH toàn bộ lead demo còn sót từ phiên bản cũ:
 * - Công ty có dấu hiệu demo "(demo)" / "[demo]" trong tên hoặc tên gốc
 *   (cascade tự xóa contact/evidence/score/fit/task/event; SourceRecord → SetNull)
 * - Bằng chứng gắn nhãn [DEMO]
 * - Segment "[DEMO] ..." (mẫu số minh họa ảo)
 * - Suppression mẫu ghi chú "DEMO: ..."
 * KHÔNG đụng lead thật — chỉ xóa bản ghi có nhãn demo rõ ràng.
 */
export async function purgeDemoData(): Promise<PurgeDemoResult> {
  // công ty demo theo tên
  const demoCompanies = await db.company.findMany({
    where: {
      OR: [
        { name: { contains: "(demo)" } },
        { name: { contains: "(Demo)" } },
        { name: { contains: "[demo]" } },
        { rawName: { contains: "(demo)" } },
        { rawName: { contains: "(Demo)" } },
      ],
    },
    select: { id: true },
  });
  const demoIds = demoCompanies.map((c) => c.id);
  let deletedEvidences = 0;
  if (demoIds.length > 0) {
    const ev = await db.evidence.deleteMany({ where: { companyId: { in: demoIds } } });
    deletedEvidences = ev.count;
    await db.company.deleteMany({ where: { id: { in: demoIds } } });
  }
  // bằng chứng demo dởm khác (nhãn [DEMO] trên công ty không còn tồn tại)
  const evDemo = await db.evidence.deleteMany({ where: { summary: { contains: "[DEMO]" } } });
  deletedEvidences += evDemo.count;
  // segment demo
  const seg = await db.segment.deleteMany({ where: { name: { contains: "[DEMO]" } } });
  // suppression demo
  const sup = await db.suppressionEntry.deleteMany({ where: { reason: { contains: "DEMO" } } });
  const result: PurgeDemoResult = {
    deletedCompanies: demoIds.length,
    deletedSegments: seg.count,
    deletedSuppressions: sup.count,
    deletedEvidences,
  };
  await audit({ action: "admin.purge_demo", entityType: "System", detail: { ...result } });
  return result;
}
