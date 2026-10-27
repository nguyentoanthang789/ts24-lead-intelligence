// ============================================================
// Seed dữ liệu DEMO — toàn bộ là dữ liệu tổng hợp (synthetic), KHÔNG phải khách hàng thật
// Chạy qua pipeline chuẩn (normalize + dedup + score) để demo đúng luồng nghiệp vụ
// ============================================================

import { db } from "@/lib/db";
import { processRecords, rescoreCompanies } from "./import-pipeline";
import { DEFAULT_SCORING_CONFIG, ScoringConfig } from "./scoring-config";

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
  {
    name: "Danh bạ doanh nghiệp công khai (demo — cần xem xét)",
    type: "PUBLIC_DIRECTORY",
    url: "https://example.com/business-directory",
    accessPolicy: "REVIEW_REQUIRED",
    allowedScope: "Chưa xác định — cần kiểm tra điều khoản sử dụng",
    isActive: false,
    needsReview: true,
    dataRightsNote: null,
  },
];

/**
 * Dữ liệu demo TỔNG HỢP: các công ty KHÔNG tồn tại ngoài lifecycle này.
 * Có 2 dòng trùng MST để demo khử trùng lặp; có dòng thiếu MST/sai MST để demo xử lý lỗi.
 */
export const DEMO_ROWS: Record<string, string>[] = [
  // nhóm A — thương mại/bán lẻ
  { ten_doanh_nghiep: "Cong ty TNHH Minh Phat (demo)", ma_so_thue: "0312345677", dien_thoai: "0901234567", email: "info@minhphat-demo.vn", website: "https://minhphat-demo.vn", tinh: "TP. Hồ Chí Minh", dia_chi: "12 Nguyễn Trãi, Q.1", nganh_nghe: "Thương mại phân phối vật liệu xây dựng", nam_thanh_lap: "2021", trang_thai: "Đang hoạt động" },
  { ten_doanh_nghiep: "Công ty TNHH Minh Phát (demo)", ma_so_thue: "0312345677", dien_thoai: "090-123-4567", tinh: "TP. HCM", nganh_nghe: "Thương mại phân phối vật liệu xây dựng" }, // trùng MST → demo merge
  { ten_doanh_nghiep: "Cong ty Co phan Ban le Nha Xanh (demo)", ma_so_thue: "0101234565", dien_thoai: "0912345678", email: "lienhe@nhaxanh-demo.vn", website: "https://nhaxanh-demo.vn", tinh: "Hà Nội", dia_chi: "88 Hoàng Quốc Việt, Cầu Giấy", nganh_nghe: "Bán lẻ gia dụng, nội thất", nam_thanh_lap: "2019", trang_thai: "Đang hoạt động" },
  { ten_doanh_nghiep: "Cong ty CP Chuoi Thuc Pham Vung Chat (demo)", ma_so_thue: "2401234560", dien_thoai: "0987654321", email: "cskh@vungchat-demo.vn", website: "https://vungchat-demo.vn", tinh: "Đà Nẵng", nganh_nghe: "Thực phẩm, chuỗi cửa hàng bán lẻ", nam_thanh_lap: "2023", trang_thai: "Đang hoạt động" },
  // nhóm B/C — sản xuất, tuyển dụng
  { ten_doanh_nghiep: "Cong ty TNHH San Xuat An Cuong (demo)", ma_so_thue: "0305512342", dien_thoai: "02838123456", email: "tuyendung@ancuong-demo.vn", website: "https://ancuong-demo.vn", tinh: "TP. Hồ Chí Minh", nganh_nghe: "Sản xuất cơ khí, chế biến", nam_thanh_lap: "2015", trang_thai: "Đang hoạt động" },
  { ten_doanh_nghiep: "Cong ty TNHH May Mac Hoa Binh (demo)", ma_so_thue: "0909876548", dien_thoai: "0241234567", website: "https://hoabinh-demo.vn", tinh: "Hà Nội", nganh_nghe: "May mặc, sản xuất", nam_thanh_lap: "2012" },
  { ten_doanh_nghiep: "Cong ty CP Logistik Song Han (demo)", ma_so_thue: "0315678904", dien_thoai: "0905551234", email: "info@songhan-demo.vn", website: "https://songhan-demo.vn", tinh: "Hải Phòng", nganh_nghe: "Logistics, giao nhận vận tải", nam_thanh_lap: "2018", trang_thai: "Đang hoạt động" },
  // nhóm D/E — nhiều phòng ban, quy trình
  { ten_doanh_nghiep: "Cong ty CP Bao Hiem Tin Tac (demo)", ma_so_thue: "0105567892", dien_thoai: "0961234567", email: "vanhanh@tintac-demo.vn", website: "https://tintac-demo.vn", tinh: "TP. Hồ Chí Minh", nganh_nghe: "Bảo hiểm", nam_thanh_lap: "2008", trang_thai: "Đang hoạt động" },
  { ten_doanh_nghiep: "Cong ty TNHH Xay Dung Truong Thinh (demo)", ma_so_thue: "2501234564", dien_thoai: "0934567890", website: "https://truongthinh-demo.vn", tinh: "Bình Dương", nganh_nghe: "Xây dựng, thi công tổng thầu", nam_thanh_lap: "2010" },
  // dòng lỗi — MST sai định dạng (demo ERROR)
  { ten_doanh_nghiep: "Cong ty TNHH Sai Ma So Thue (demo)", ma_so_thue: "12345", dien_thoai: "0977778888", tinh: "Hà Nội", nganh_nghe: "Thương mại" },
  // dòng thiếu MST — hợp lệ nhưng confidence thấp (demo NEEDS_VERIFICATION)
  { ten_doanh_nghiep: "Cong ty Co phan Du An Mo Rong (demo)", dien_thoai: "0988777666", email: "duan@morong-demo.vn", tinh: "Đà Nẵng", nganh_nghe: "Thương mại dịch vụ", nam_thanh_lap: "2024" },
  // NE là demo cần review (tên giống DN khác nhưng khác tỉnh)
  { ten_doanh_nghiep: "Cong ty TNHH Minh Phat Binh Duong (demo)", ma_so_thue: "3701123451", dien_thoai: "0274123456", tinh: "Bình Dương", nganh_nghe: "Thương mại phân phối", nam_thanh_lap: "2022" },
];

export async function seedDemoData(config: ScoringConfig = DEFAULT_SCORING_CONFIG) {
  // 1) sản phẩm
  for (const p of PRODUCT_SEED) {
    await db.product.upsert({ where: { code: p.code }, create: p, update: p });
  }
  // 2) templates
  const existingTemplates = await db.messageTemplate.count();
  if (existingTemplates === 0) {
    for (const t of TEMPLATE_SEED) {
      await db.messageTemplate.create({ data: { ...t, productCode: t.productCode ?? undefined } });
    }
  }
  // 3) sources
  for (const s of SOURCE_SEED) {
    await db.source.upsert({ where: { name: s.name }, create: s, update: {} });
  }
  // 4) demo segment có mẫu số — ghi rõ là DEMO minh họa phương pháp, cần thay bằng nguồn thực
  const segName = "[DEMO] Thương mại TP.HCM";
  const existingSeg = await db.segment.findFirst({ where: { name: segName } });
  if (!existingSeg) {
    await db.segment.create({
      data: {
        name: segName,
        province: "TP. Hồ Chí Minh",
        sector: "thuong mai",
        estimatedTotal: 100000,
        denominatorSource: "DEMO minh họa phương pháp — thay bằng số liệu đăng ký kinh doanh thực tế trước khi dùng",
        documented: false, // DEMO không tự coi là đã tài liệu hóa → không hiện % cho đến khi thay nguồn thật
        notes: "Phân khúc mẫu để trình bày cơ chế: chỉ khi documented=true và có denominatorSource thực tế thì % mới được tính",
      },
    });
  }
  // 5) suppression demo
  const supValue = "08499999999";
  const existingSup = await db.suppressionEntry.findUnique({ where: { value_scope: { value: supValue, scope: "GLOBAL" } } });
  if (!existingSup) {
    await db.suppressionEntry.create({ data: { value: supValue, scope: "GLOBAL", reason: "DEMO: doanh nghiệp yêu cầu không liên hệ" } });
  }
  // 6) companies qua pipeline (idempotent theo dedupKey)
  const fileSource = await db.source.findUnique({ where: { name: "Tệp import nội bộ" } });
  if (!fileSource) throw new Error("Seed: không tìm thấy nguồn import");
  const result = await processRecords({ sourceId: fileSource.id, rows: DEMO_ROWS, config });
  // 7) bằng chứng demo cho một số DN (giả lập bằng chứng công khai — ghi rõ nguồn demo)
  const anc = await db.company.findFirst({ where: { name: { contains: "An Cuong" } } });
  if (anc && !(await db.evidence.findFirst({ where: { companyId: anc.id, kind: "HIRING" } }))) {
    await db.evidence.create({ data: { companyId: anc.id, kind: "HIRING", summary: "[DEMO] Công bố tin tuyển dụng 20 công nhân sản xuất", sourceName: "Tệp import nội bộ", confidence: "MEDIUM" } });
  }
  const tintac = await db.company.findFirst({ where: { name: { contains: "Tin Tac" } } });
  if (tintac && !(await db.evidence.findFirst({ where: { companyId: tintac.id, kind: "MULTI_DEPT" } }))) {
    await db.evidence.create({ data: { companyId: tintac.id, kind: "MULTI_DEPT", summary: "[DEMO] Trang công khai mô tả 5 phòng ban nghiệp vụ", sourceName: "Tệp import nội bộ", confidence: "HIGH" } });
  }
  const truongthinh = await db.company.findFirst({ where: { name: { contains: "Truong Thinh" } } });
  if (truongthinh && !(await db.evidence.findFirst({ where: { companyId: truongthinh.id, kind: "PROCESS_SIGNAL" } }))) {
    await db.evidence.create({ data: { companyId: truongthinh.id, kind: "PROCESS_SIGNAL", summary: "[DEMO] Công bố quy trình phê duyệt dự án nhiều cấp", sourceName: "Tệp import nội bộ", confidence: "MEDIUM" } });
  }
  // rescore các công ty vừa thêm bằng chứng
  const all = await db.company.findMany({ select: { id: true } });
  await rescoreCompanies(all.map((c) => c.id), config);
  return result;
}
