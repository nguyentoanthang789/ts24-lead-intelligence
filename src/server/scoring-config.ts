// ============================================================
// Module 5 — Cấu hình chấm điểm & tiêu chí matching (versioned, quản trị được)
// Người quản trị cập nhật danh mục sản phẩm, tiêu chí, ngưỡng mà KHÔNG phải sửa logic
// ============================================================

export const PRODUCT_CODES = ["A", "B", "C", "D", "E", "F"] as const;
export type ProductCode = (typeof PRODUCT_CODES)[number];

export const EVIDENCE_KINDS = [
  "SECTOR", "HIRING", "HIRING_ACCOUNTANT", "BRANCHES", "MULTI_DEPT",
  "EXPANSION", "ACCOUNTING_ACTIVITY", "DIGITIZATION_SIGNAL",
  "PROCESS_SIGNAL", "E_SIGN_SIGNAL", "PUBLIC_CONTACT", "DOCUMENT", "OTHER",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_CONFIDENCE_POINTS: Record<string, number> = {
  HIGH: 8,
  MEDIUM: 5,
  LOW: 2,
};

export type SignalRule = {
  kind: EvidenceKind;
  points: number; // điểm fit 0-100 cộng theo bằng chứng
  label: string;
};

export type ProductCriteria = {
  /** keyword khớp với sector đã chuẩn hóa (bỏ dấu) */
  sectorKeywords: string[];
  signals: SignalRule[];
  /** ngưỡng fitScore (0-100) để coi là "phù hợp" sản phẩm này */
  minFitScore: number;
  /** ngưỡng điểm sản phẩm riêng theo spec 5.2 (có thể cấu hình theo sản phẩm) */
  tierOverride?: { high: number };
};

export type ScoringConfig = {
  version: number;
  weights: {
    productFit: number; // max 30
    evidence: number;   // max 25
    segment: number;    // max 20
    contact: number;    // max 15
    freshness: number;  // max 10
  };
  /** Ngưỡng phân hạng tổng thể */
  tierThresholds: {
    high: number;            // >= high → Ưu tiên cao
    needsVerification: number; // >= nv → Cần xác minh thêm (hoặc confidence thấp)
    low: number;             // >= low → Ưu tiên thấp; dưới → Không phù hợp
  };
  /** Số ngày dữ liệu được coi là mới (đủ điểm freshness); decay về 0 sau 4x */
  freshnessDays: number;
  /** Tỉnh/trọng điểm nhận điểm segment */
  keyProvinces: string[];
  /** Số tuổi công ty tính là "mới" (ưu tiên kê khai thuế) */
  newBusinessYears: number;
  productCriteria: Record<ProductCode, ProductCriteria>;
};

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  version: 1,
  weights: { productFit: 30, evidence: 25, segment: 20, contact: 15, freshness: 10 },
  tierThresholds: { high: 70, needsVerification: 45, low: 20 },
  freshnessDays: 90,
  keyProvinces: ["TP. Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Bình Dương", "Đồng Nai", "Hải Phòng"],
  newBusinessYears: 2,
  productCriteria: {
    A: {
      // Hóa đơn điện tử: DN bán hàng, dịch vụ, phân phối, bán lẻ, chuỗi
      sectorKeywords: [
        "ban le", "phan phoi", "thuong mai", "ban buon", "ban buon le",
        "gia dung", "voi sinh", "xay dung vat lieu", "noi that", "trang suc",
        "thuc pham", "am thuc", "khach san", "du lich", " giao nhan", "van tai",
        "my pham", "thoi trang", "dien may", "nha sach", "cua hang", "showroom",
      ],
      signals: [
        { kind: "EXPANSION", points: 25, label: "Dấu hiệu mở rộng kinh doanh" },
        { kind: "BRANCHES", points: 15, label: "Nhiều điểm bán/chi nhánh bán lẻ" },
        { kind: "HIRING", points: 10, label: "Đang tuyển nhân sự kinh doanh/vận hành" },
        { kind: "PUBLIC_CONTACT", points: 5, label: "Công bố kênh liên hệ kinh doanh" },
      ],
      minFitScore: 50,
    },
    B: {
      // Kê khai thuế điện tử: DN hoạt động, công ty mới, nhu cầu chuẩn hóa kế toán
      sectorKeywords: [
        "thuong mai", "dich vu", "xay dung", "san xuat", "van tai", "tu van",
        "phan mem", "cong nghe", "giai khau", "nha hang", "du lich", "thiet ke",
        "truyen thong", "marketing", "logistics", "khoang san", "nong nghiep",
      ],
      signals: [
        { kind: "ACCOUNTING_ACTIVITY", points: 30, label: "Bằng chứng hoạt động kế toán công khai" },
        { kind: "HIRING_ACCOUNTANT", points: 25, label: "Tuyển dụng kế toán/thuế" },
        { kind: "EXPANSION", points: 15, label: "Mở rộng — phát sinh hóa đơn/kê khai mới" },
        { kind: "SECTOR", points: 10, label: "Ngành có nghiệp vụ kê khai thường xuyên" },
      ],
      minFitScore: 45,
    },
    C: {
      // BHXH điện tử: có nhân sự, tuyển dụng, nhiều địa điểm
      sectorKeywords: [
        "san xuat", "may mac", "che bien", "xay dung", "logistics", "van tai",
        "nhan luc", "dao tao", "y te", "giao duc", "nha hang", "khach san",
        "bep an cong nghiep", "guard", "bao ve", "ve sinh", "facilities",
      ],
      signals: [
        { kind: "HIRING", points: 30, label: "Đang tuyển dụng — có nhân sự cần quản lý" },
        { kind: "BRANCHES", points: 20, label: "Nhiều địa điểm kinh doanh" },
        { kind: "MULTI_DEPT", points: 15, label: "Nhiều phòng ban/nghiệp vụ lao động" },
      ],
      minFitScore: 50,
    },
    D: {
      // Số hóa tài liệu & lưu trữ: nhiều hồ sơ, nhiều phòng ban/chi nhánh
      sectorKeywords: [
        "ngan hang", "bao hiem", "chung khoan", "y te", "benh vien", "phong kham",
        "xay dung", "bat dong san", "luat", "hanh chinh", "giao duc", "nha nuoc",
        "van phong", "huu nghi", "cong doan", "logistics", "khai thac", "hang khong",
      ],
      signals: [
        { kind: "DIGITIZATION_SIGNAL", points: 30, label: "Công bố nhu cầu số hóa/lưu trữ" },
        { kind: "MULTI_DEPT", points: 20, label: "Nhiều phòng ban tạo hồ sơ nghiệp vụ" },
        { kind: "BRANCHES", points: 15, label: "Nhiều chi nhánh lưu trữ tài liệu" },
        { kind: "DOCUMENT", points: 10, label: "Bằng chứng khối lượng hồ sơ lớn" },
      ],
      minFitScore: 50,
    },
    E: {
      // Quản lý quy trình nghiệp vụ: nhiều bước phê duyệt, nhiều đơn vị
      sectorKeywords: [
        "san xuat", "xay dung", "tap doan", "chuoi", "phan mem", "cong nghe",
        "khai thac", "dien luc", "nuoc", "moi truong", "kiem dinh", "giam dinh",
        "giao thong", "du an", "thi cong", "tong thau",
      ],
      signals: [
        { kind: "PROCESS_SIGNAL", points: 30, label: "Dấu hiệu nhu cầu chuẩn hóa quy trình" },
        { kind: "MULTI_DEPT", points: 20, label: "Nhiều đơn vị vận hành/phê duyệt" },
        { kind: "BRANCHES", points: 10, label: "Vận hành nhiều địa điểm" },
      ],
      minFitScore: 50,
    },
    F: {
      // Chữ ký số & giao dịch điện tử
      sectorKeywords: [
        "xuat nhap khau", "nhap khau", "xuat khau", "hai quan", "logistics",
        "thuong mai", "chung khoan", "ngan hang", "bao hiem", "thau", "dau thau",
        "xay dung", "thi cong", "dat dai", "khai thac", "vat tu", "thuoc",
      ],
      signals: [
        { kind: "E_SIGN_SIGNAL", points: 30, label: "Nhu cầu ký điện tử công khai" },
        { kind: "DOCUMENT", points: 15, label: "Nghiệp vụ hồ sơ điện tử (thau/hải quan...)" },
        { kind: "SECTOR", points: 10, label: "Ngành có giao dịch điện tử thường xuyên" },
      ],
      minFitScore: 45,
    },
  },
};

/** Kiểm tra tổng trọng số đúng 100 và mọi ngưỡng hợp lệ */
export function validateScoringConfig(cfg: ScoringConfig): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const w = cfg.weights;
  const total = w.productFit + w.evidence + w.segment + w.contact + w.freshness;
  if (total !== 100) errors.push(`Tổng trọng số phải = 100, hiện tại = ${total}`);
  for (const [k, v] of Object.entries(w)) {
    if (typeof v !== "number" || v < 0 || v > 100) errors.push(`Trọng số ${k} không hợp lệ: ${v}`);
  }
  const t = cfg.tierThresholds;
  if (!(t.high > t.needsVerification && t.needsVerification > t.low && t.low >= 0)) {
    errors.push("Ngưỡng phân hạng phải thỏa high > needsVerification > low >= 0");
  }
  if (cfg.freshnessDays <= 0) errors.push("freshnessDays phải > 0");
  for (const code of PRODUCT_CODES) {
    const pc = cfg.productCriteria[code];
    if (!pc) errors.push(`Thiếu tiêu chí sản phẩm ${code}`);
    else if (pc.minFitScore < 0 || pc.minFitScore > 100) errors.push(`minFitScore của ${code} phải trong 0-100`);
  }
  return { ok: errors.length === 0, errors };
}
