# TS24 Lead Intelligence

Hệ thống tìm kiếm, đánh giá và quản lý khách hàng tiềm năng cho các sản phẩm, dịch vụ TS24 — MVP modular monolith.

> **Nguyên tắc cốt lõi:** tự động hóa tìm kiếm, xử lý dữ liệu, phân loại, cá nhân hóa nội dung và quản lý công việc; **không tự động gửi tin nhắn** qua tài khoản Zalo cá nhân.

---

## 1. Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (SPA quản trị — 1 route, 6 view)         │
│  Overview · Lead Explorer · Sources · Coverage · Outreach ·     │
│  Settings & Audit                                               │
└───────────────┬─────────────────────────────────────────────────┘
                │ fetch /api/*
┌───────────────▼─────────────────────────────────────────────────┐
│  API Routes (schema validation · phân trang server-side ·       │
│  error envelope · token guard · audit log)                      │
├─────────────────────────────────────────────────────────────────┤
│  MODULES (src/server) — ranh giới rõ ràng, tái sử dụng được     │
│  ─ normalization   chuẩn hóa MST/phone/domain/tên/tỉnh          │
│  ─ dedup           identity resolution (MST>domain>phone>tên)   │
│  ─ import-pipeline parse→validate→normalize→dedup→persist→score │
│  ─ sources/        Source Registry + Collector Adapters         │
│  ─ scoring-config  thang điểm + tiêu chí sản phẩm (versioned)   │
│  ─ matching        fit từng sản phẩm A–F                        │
│  ─ scoring         tổng điểm 0–100 có giải thích                │
│  ─ coverage        độ bao phủ + phát hiện khoảng trống          │
│  ─ templates       render mẫu tin (không bịa biến thiếu)        │
│  ─ compliance      audit log (sanitized) + suppression          │
│  ─ settings        đọc/lưu cấu hình versioned                   │
│  ─ seed            dữ liệu demo tổng hợp                        │
└───────────────┬─────────────────────────────────────────────────┘
                │ Prisma ORM
┌───────────────▼─────────────────────────────────────────────────┐
│  SQLite (MVP) / PostgreSQL — 18 model: Company, ContactPoint,   │
│  Source, SourceRecord, Evidence, CollectionJob(+Checkpoint),    │
│  Product, ProductFit, LeadScore, Segment, Campaign,             │
│  OutreachTask, MessageTemplate, OutreachEvent, SuppressionEntry,│
│  AuditEvent, User, AppSetting                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Phân tách trách nhiệm:** UI chỉ gọi API; nghiệp vụ nằm trong module thuần (pure function để kiểm thử); lưu trữ qua Prisma; mọi thao tác quan trọng ghi `AuditEvent` đã sanitize.

## 2. Cấu trúc thư mục

```
src/
  app/
    page.tsx                 # SPA shell — sidebar điều hướng 6 view
    api/                     # 20 route handlers (xem mục API)
  components/crm/            # view components + badges + lead detail
  lib/crm-api.ts             # client fetcher + nhãn tiếng Việt
  server/
    normalization.ts  dedup.ts  import-pipeline.ts  csv.ts
    scoring-config.ts matching.ts scoring.ts coverage.ts
    templates.ts compliance.ts settings.ts http.ts seed.ts
    sources/adapters.ts      # Collector Engine
prisma/schema.prisma         # 18 model (SQLite, portable sang PostgreSQL)
scripts/seed.ts              # nạp dữ liệu demo
tests/unit/*.test.ts         # unit tests (bun test)
tests/integration-run.ts     # E2E pipeline (DB riêng)
tests/fixtures/*.csv         # fixture import
```

## 3. Yêu cầu runtime & dependency

- **Bun ≥ 1.1** (hoặc Node ≥ 20 + npm/yarn/pnpm)
- **Next.js 16**, **TypeScript 5**, **Tailwind CSS 4 + shadcn/ui**, **Prisma 6**
- Package phụ thêm: `xlsx` (import XLSX). Còn lại theo `package.json` (lockfile `bun.lock`)

## 4. Biến môi trường

Tạo file `.env` (tham khảo `.env.example`):

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | ✅ | `file:/absolute/path/db/custom.db` (SQLite). Với PostgreSQL: `postgresql://user:pass@host:5432/ts24` |
| `CRM_API_TOKEN` | ❌ | Khi đặt, mọi API ghi (POST/PATCH/PUT/DELETE) yêu cầu header `x-api-token`. Bỏ trống = chế độ demo single-operator |

Không có biến môi trường nào cho Zalo — hệ thống **chủ động không tích hợp API/credential Zalo**.

## 5. Thiết lập cơ sở dữ liệu

```bash
bun install
# SQLite (mặc định):
bun run db:push          # tạo bảng theo schema (không cần migrate files)
bun run seed             # nạp dữ liệu demo tổng hợp + 6 sản phẩm + 3 mẫu tin
# PostgreSQL: đổi provider trong prisma/schema.prisma thành "postgresql"
# rồi chạy lại bun run db:push
```

## 6. Chạy ứng dụng

```bash
bun run dev      # dev server tại http://localhost:3000
bun run build    # build production (standalone)
bun run start    # chạy production
```

## 7. Import dữ liệu

Cách 1 — UI: **Lead Explorer → Import CSV/XLSX** (tải tệp mẫu tại link trong hộp thoại).
Cách 2 — API:

```bash
curl -F "file=@danh-sach.csv" -F "sourceName=Tệp khách hàng Q4" http://localhost:3000/api/import
```

Cột nhận diện (không phân biệt hoa thường/dấu): `ten_doanh_nghiep|name`, `ma_so_thue|mst`, `dien_thoai|phone`, `email`, `website`, `tinh|province`, `nganh_nghe|sector`, `nam_thanh_lap`, `trang_thai|business_status`, `dia_chi|address`, `quy_mo|size`.

Pipeline tự động: chuẩn hóa → khử trùng lặp (trong nguồn = DUPLICATE; khác nguồn = merge theo MST/domain/phone/tên+tỉnh) → bản ghi lỗi ghi rõ nguyên nhân → bản ghi không chắc chắn vào `NEEDS_REVIEW` → chấm điểm.
Xuất dữ liệu: `/api/export?view=companies` hoặc nút **Xuất CSV** (cột liên hệ được mask).

## 8. Thêm nguồn dữ liệu hợp lệ

1. **Nguồn dữ liệu → Thêm nguồn** — khai báo tên, loại, URL, phạm vi được phép, quyền sử dụng.
2. Nguồn mới luôn `REVIEW_REQUIRED` + tắt. Bấm **Kiểm tra** → hệ thống fetch `robots.txt`, kiểm tra khả năng truy cập HTTP.
3. Sau khi xác minh điều khoản: chuyển chính sách sang **Được phép** rồi mới bật công tắc.
4. Bấm **Chạy job** → job chạy bất đồng bộ (có pause/cancel/resume/retry, checkpoint, rate limit).

Chính sách tuyệt đối: không thu thập khi `robots.txt` cấm (`Disallow: /`), không vượt CAPTCHA/chống bot/paywall, không đăng nhập trái phép, **không tạo dữ liệu giả** khi không lấy được (job ghi nhận và dừng an toàn).

## 9. Chấm điểm & xem độ bao phủ

- **Thang điểm 0–100** (cấu hình tại Cài đặt): Phù hợp sản phẩm 0–30 · Bằng chứng nhu cầu 0–25 · Phân khúc 0–20 · Khả năng liên hệ 0–15 · Độ mới dữ liệu 0–10. Lưu cấu hình → tự tăng `ruleVersion`; mọi LeadScore lưu kèm phiên bản quy tắc.
- **Phân hạng:** Ưu tiên cao (≥70) · Cần xác minh (≥45 hoặc tin cậy thấp) · Ưu tiên thấp (≥20) · Không phù hợp. Mỗi hạng kèm lý do hiển thị.
- **Sản phẩm A–F:** điểm fit 0–100 riêng từng sản phẩm, tính từ sector match + bằng chứng (HIRING, EXPANSION, MULTI_DEPT, DIGITIZATION_SIGNAL, E_SIGN_SIGNAL…) với hệ số tin cậy.
- **Coverage Dashboard:** theo nguồn/tỉnh/ngành/sản phẩm; tỷ lệ trùng/lỗi/chưa xác minh; phát hiện khoảng trống kèm đề xuất.
- **Không tạo tỷ lệ giả:** % bao phủ thị trường chỉ tính cho phân khúc khai báo `estimatedTotal` kèm `denominatorSource` được tài liệu hóa; nếu không → hiển thị **"Chưa xác định mẫu số bao phủ"**.

## 10. Quy trình tiếp cận Zalo (thủ công bắt buộc)

1. Lead Explorer → mở lead → **Tạo bản nháp** (chọn mẫu theo sản phẩm).
2. Hệ thống render từ dữ liệu thực; **biến thiếu được cảnh báo, không tự điền**.
3. Sửa nội dung (nếu cần) → **Sao chép tin nhắn**.
4. **Mở Zalo Web** → mở `https://chat.zalo.me/` trong tab mới (không truyền dữ liệu gì).
5. Bạn **tự chọn người nhận, tự kiểm tra và gửi** trên Zalo.
6. Quay lại CRM: **Đánh dấu đã liên hệ / Ghi nhận phản hồi / Quan tâm / Lịch theo dõi / Không phù hợp / Không tiếp tục liên hệ / Trả về hàng xác minh**.

Hệ thống **không** có: API gửi tin, tự kết bạn, đọc cookie/token/session Zalo, mô phỏng thao tác. Trạng thái `CONTACTED` chỉ tồn tại khi bạn bấm xác nhận. Lead nằm trong **Danh sách loại trừ** (Settings) không thể tạo draft/task.

## 11. Kiểm thử

```bash
bun run lint             # ESLint
bun run typecheck        # tsc --noEmit
bun run test             # 61 unit tests (normalization, dedup, scoring, templates, connector, csv, policy)
bun run test:integration # 27 asserts E2E (DB riêng tests/db test-int.db)
bun run test:all         # cả hai
```

Ma trận kiểm thử theo spec: **A** chuẩn hóa+khử trùng lặp · **B** connector (robots, retry, policy, không mạng thật) · **C** chấm điểm (biên, giải thích, versioning) · **D** coverage (không tạo % giả) · **E** outreach (template, suppression, quét tĩnh chống auto-send) · **F** audit/sanitize · **G** E2E pipeline.

## 12. Giới hạn & phụ thuộc bên ngoài (trung thực)

- **Chưa tích hợp nguồn bên ngoài nào**: connector webpage có robots-check thật nhưng MVP chưa kèm parser cấu trúc cho danh bạ cụ thể — job sẽ ghi "chưa khai báo bộ phân tích" thay vì bịa dữ liệu. Khi có nguồn được phép, viết parser trong `src/server/sources/`.
- **Xác thực người dùng**: MVP single-operator; có token guard qua `CRM_API_TOKEN`; NextAuth có thể ghép sau (model `User` đã có).
- **SQLite** phù hợp MVP; chuyển PostgreSQL chỉ cần đổi `provider` + chạy `db:push`.
- **Chưa có worker tách biệt** — job chạy bất đồng bộ trong tiến trình app (đủ MVP); khi khối lượng lớn, tách theo kế hoạch modular monolith.
- **Mô hình điểm** là ưu tiên ban đầu — cần kiểm chứng bằng kết quả sales thực tế; chưa có huấn luyện/tự học (chỉ lưu phản hồi + báo cáo).

## 13. Backup, phục hồi, lưu giữ

- SQLite: sao chép tệp `db/custom.db` (dừng ghi hoặc dùng `sqlite3 .backup`). Lịch đề xuất: hằng ngày, giữ 30 bản.
- Phục hồi: thay tệp DB + khởi động lại app. Với PostgreSQL: `pg_dump`/`pg_restore`.
- **Lưu giữ dữ liệu**: `Source.retentionDays` (mặc định 365) — khai báo theo từng nguồn; khi triển khai thật, cần cron dọn `SourceRecord` quá hạn (chưa bật trong MVP, ghi nhận rõ).

## 14. Thao tác cho quản trị viên

- **Cài đặt → Chấm điểm**: chỉnh trọng số (tổng phải = 100), ngưỡng hạng, tên người gửi; bấm **Chạy lại chấm điểm**.
- **Cài đặt → Mẫu tin nhắn**: CRUD mẫu theo sản phẩm, dùng biến `{company_name} {business_sector} {product_name} {verified_business_context} {sender_name}`.
- **Cài đặt → Danh sách loại trừ**: thêm MST/phone/email/domain → lead bị chặn khỏi hàng đợi.
- **Cài đặt → Audit log**: theo dõi thao tác (đã sanitize, không chứa dữ liệu liên hệ).
- **Nguồn dữ liệu**: duyệt chính sách truy cập trước khi bật; kiểm soát job.
- **Nạp dữ liệu demo**: nút ở Cài đặt (dữ liệu tổng hợp, có đuôi "(demo)", không phải khách hàng thật).

---

## API chính

| Nhóm | Endpoint |
|---|---|
| Lead | `GET/POST /api/companies`, `GET/PATCH /api/companies/[id]`, `POST /api/score` |
| Pipeline | `POST /api/import`, `GET /api/import` (tệp mẫu), `GET /api/export` |
| Nguồn | `GET/POST /api/sources`, `PATCH /api/sources/[id]`, `POST /api/sources/[id]/check` |
| Job | `GET/POST /api/jobs`, `POST /api/jobs/[id]` (pause/resume/cancel/retry) |
| Bao phủ | `GET /api/coverage` |
| Tiếp cận | `GET/POST /api/outreach`, `POST /api/outreach/draft`, `GET/POST /api/outreach/events` |
| Chiến dịch | `GET/POST /api/campaigns` |
| Mẫu tin | `GET/POST /api/templates`, `PATCH/DELETE /api/templates/[id]` |
| Tuân thủ | `GET/POST/DELETE /api/suppression`, `GET /api/audit` |
| Hệ thống | `GET/PUT /api/settings`, `POST /api/admin/seed`, `GET /api/overview` |

Lỗi trả về thống nhất: `{ ok: false, error: { code, message } }`.
