# TS24 Lead Intelligence

Hệ thống tìm kiếm, đánh giá và quản lý khách hàng tiềm năng cho các sản phẩm, dịch vụ TS24 — MVP modular monolith.

> **Nguyên tắc cốt lõi:** tự động hóa tìm kiếm, xử lý dữ liệu, phân loại, cá nhân hóa nội dung và quản lý công việc; **không tự động gửi tin nhắn** qua tài khoản Zalo cá nhân.
> **Tự động hóa:** tự dò ứng viên nguồn (Source Discovery) + tự chạy pipeline hằng ngày theo lịch (Scheduler, mặc định 09:30 Asia/Ho_Chi_Minh).

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
│  ─ discovery       tự dò ứng viên nguồn (robots + HTTP probe)   │
│  ─ scheduler       tự chạy pipeline theo lịch hằng ngày         │
│  ─ scoring-config  thang điểm + tiêu chí sản phẩm (versioned)   │
│  ─ matching        fit từng sản phẩm A–F                        │
│  ─ scoring         tổng điểm 0–100 có giải thích                │
│  ─ coverage        độ bao phủ + phát hiện khoảng trống          │
│  ─ templates       render mẫu tin (không bịa biến thiếu)        │
│  ─ compliance      audit log (sanitized) + suppression          │
│  ─ settings        đọc/lưu cấu hình versioned                   │
│  ─ seed            catalog seed (sản phẩm/mẫu/nguồn) + purge demo │
│  ─ extract         trích DN thật từ HTML/JSON nguồn công khai   │
│  ─ collector-config tốc độ cào: số trang / song song / timeout  │
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
    api/                     # 25 route handlers (xem mục API)
  components/crm/            # view components + badges + lead detail
  lib/crm-api.ts             # client fetcher + nhãn tiếng Việt
  server/
    normalization.ts  dedup.ts  import-pipeline.ts  csv.ts
    scoring-config.ts matching.ts scoring.ts coverage.ts
    templates.ts compliance.ts settings.ts http.ts seed.ts
    extract.ts               # trích xuất doanh nghiệp thật từ HTML/JSON
    collector-config.ts      # cấu hình tốc độ thu thập + pool song song
    sources/adapters.ts      # Collector Engine (cào đa trang, robots-aware)
    discovery.ts             # Source Discovery — tự dò ứng viên nguồn
    scheduler.ts             # Auto-Run Scheduler — tự chạy theo lịch
    continuous.ts            # Continuous Runner — chạy liên tục không nghỉ
    inbox.ts                 # Auto-Import Inbox — nhập tệp tự động
  instrumentation.ts         # khởi động scheduler + continuous khi server bật
prisma/schema.prisma         # 18 model (SQLite, portable sang PostgreSQL)
scripts/seed.ts              # nạp catalog cấu hình (KHÔNG tạo lead giả)
scripts/purge-demo.ts        # xóa sạch lead demo còn sót (chạy 1 lần)
scripts/benchmark-throughput.ts # đo thông lượng lead/giây
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
bun run seed             # nạp catalog cấu hình: 6 sản phẩm + 3 mẫu tin + nguồn gốc (KHÔNG tạo lead giả)
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

### 8.1. Tự động dò nguồn (Source Discovery)

Bấm **Nguồn dữ liệu → Tự động dò nguồn → Dò ngay**: hệ thống tự kiểm tra `robots.txt` + khả năng truy cập HTTP của các danh bạ/cổng công khai phổ biến Việt Nam (dangkykinhdoanh.gov.vn, gso.gov.vn, masothue.com, trangvangvietnam.com, yellowpages.vn, thongtindoanhnghiep.co) và URL tùy chọn nếu nhập.

- Kết quả dò trung thực: robots OK/RESTRICTED/CHECK_FAILED, HTTP status — **không giả định cho phép khi lỗi**.
- Ứng viên đạt điều kiện được **tự thêm vào Registry** nhưng luôn ở trạng thái **chờ xem xét + tắt** — bạn xác minh điều khoản sử dụng dữ liệu rồi mới bật.
- Ứng viên trùng URL/tên nguồn có sẵn → bỏ qua (không nhân đôi).
- Scheduler tự động dò cũng dùng chính cơ chế này (nếu bật "Tự dò nguồn mới").

### 8.2. Thêm thủ công và bật thu thập

1. **Nguồn dữ liệu → Thêm nguồn** — khai báo tên, loại, URL, phạm vi được phép, quyền sử dụng.
2. Nguồn mới luôn `REVIEW_REQUIRED` + tắt. Bấm **Kiểm tra** → hệ thống fetch `robots.txt`, kiểm tra khả năng truy cập HTTP.
3. Sau khi xác minh điều khoản: chuyển chính sách sang **Được phép** rồi mới bật công tắc.
4. Bấm **Chạy job** → job chạy bất đồng bộ (có pause/cancel/resume/retry, checkpoint, rate limit).

Chính sách tuyệt đối: không thu thập khi `robots.txt` cấm (`Disallow: /`), không vượt CAPTCHA/chống bot/paywall, không đăng nhập trái phép, **không tạo dữ liệu giả** khi không lấy được (job ghi nhận và dừng an toàn).

## 9. Tự động chạy hằng ngày (Auto-Run Scheduler)

Cấu hình tại **Cài đặt → Tự động chạy** (API: `/api/scheduler`). Scheduler chạy trong tiến trình server (khởi động qua `src/instrumentation.ts`), tick mỗi 60 giây.

| Cấu hình | Mặc định | Ý nghĩa |
|---|---|---|
| `enabled` | `false` | Bật/tắt chạy tự động theo lịch |
| `runAt` | `09:30` | Giờ chạy hằng ngày (HH:MM theo timezone) |
| `timezone` | `Asia/Ho_Chi_Minh` | Múi giờ IANA tính giờ chạy + chống chạy 2 lần/ngày |
| `autoDiscover` | `true` | Tự dò ứng viên nguồn mới (xem 8.1) |
| `autoRunSources` | `true` | Tự chạy job các nguồn **mạng đang bật** (file/upload bị bỏ qua) |
| `autoRescore` | `true` | Tự chấm điểm lại toàn bộ lead theo cấu hình hiện tại |
| `retentionCleanup` | `true` | Tự xóa `SourceRecord` quá hạn `retentionDays` của từng nguồn |

- Đúng giờ cấu hình (chưa chạy trong ngày theo timezone) → pipeline tự chạy, ghi `scheduler.run_started/finished/failed` vào audit log, lưu `lastRunAt` + `lastRunDay`.
- Nút **Chạy ngay (thử)** để chạy pipeline thủ công không cần đợi lịch; có chống chồng lấn (đang chạy → bỏ qua).
- UI hiển thị **lần chạy tới** (tính theo timezone), kết quả từng bước lần chạy gần nhất, và lỗi nếu có.
- **Ranh giới tuyệt đối:** scheduler KHÔNG bao giờ gửi tin nhắn Zalo, KHÔNG tự bật nguồn mới (nguồn tự dò luôn tắt chờ duyệt), KHÔNG tạo dữ liệu thay thế khi nguồn không phản hồi.

## 9.1. Chạy toàn bộ liên tục không nghỉ (Continuous Runner — nút START)

Nút **START — Chạy toàn bộ, liên tục không nghỉ** hiển thị nổi bật ở **Tổng quan** và tại **Cài đặt → Tự động chạy** (API: `/api/continuous`). Bấm START:

1. Chạy ngay một vòng pipeline đầy đủ: dò nguồn mới → thu thập các nguồn mạng đang bật → **nhập tự động hộp thư inbox** → chấm điểm lại lead → dọn dữ liệu quá hạn.
2. Hết vòng nghỉ `intervalMinutes` rồi chạy tiếp vòng mới — lặp vô hạn 24/7 tới khi bấm STOP. **`intervalMinutes = 0` (mặc định) = KHÔNG NGHỈ**: vòng mới chạy ngay sau vòng trước, chỉ chốt 5 giây để không ép CPU/DB.
3. Server khởi động lại khi đang bật → tự phục hồi chế độ chạy tiếp (`resumeContinuousIfNeeded` trong `src/instrumentation.ts`).

Đặc tính vận hành:

| Đặc tính | Chi tiết |
|---|---|
| Chống chồng lấn | Dùng chung mutex với Auto-Run Scheduler (`isPipelineBusy`): trúng giờ lịch 09:30 thì vòng continuous tự nhường, thử lại ở vòng sau |
| Chịu lỗi | Vòng lỗi KHÔNG dừng máy — ghi audit `continuous.cycle_failed`, đếm lỗi liên tiếp, nghỉ interval rồi chạy tiếp |
| Không nghỉ | `intervalMinutes = 0` (mặc định): back-to-back với cooldown 5 giây (`NO_REST_COOLDOWN_MS`); biên hợp lệ 0–720 phút |
| STOP tức thì | Sleep giữa các vòng là interruptible — bấm STOP đánh thức loop thoát ngay; vòng đang chạy chạy xong tự nhiên |
| Cấu hình nóng | Sửa `intervalMinutes`/bộ bước giữa chừng (PUT `/api/continuous`) → áp dụng từ vòng kế tiếp |
| Minh bạch | UI realtime 5s/lần: số vòng hoàn tất, phút nghỉ, lỗi liên tiếp, giờ vòng tới, kết quả từng bước vòng gần nhất; audit `continuous.started/stopped/cycle_finished/cycle_failed/config_updated` |
| Ranh giới | Vẫn tôn trọng robots.txt + hạn tốc độ từng nguồn; KHÔNG tự gửi tin nhắn Zalo; nguồn tự dò luôn tắt chờ duyệt |

## 9.2. Hộp thư nhập tự động (Auto-Import Inbox) — kênh tự động LUÔN tạo lead

Phần lớn danh bạ/doanh nghiệp VN **chủ động chặn bot** (HTTP 403, WAF, CAPTCHA) và hệ thống **KHÔNG né các cơ chế chống bot** (đường viền tuân thủ) — vì vậy kênh "cào mạng" chỉ thu được dữ liệu khi nguồn ĐÃ được phép và cho phép truy cập. Để bot tự tạo lead 24/7 bất chấp điều đó, mỗi vòng pipeline có bước **nhập hộp thư** (module `src/server/inbox.ts`):

1. Người vận hành thả tệp CSV/XLSX doanh nghiệp vào thư mục `upload/inbox/` (đổi vị trí qua biến môi trường `TS24_INBOX_DIR`).
2. Bot tự quét ở vòng kế tiếp (tối đa 10 tệp/vòng): parse (CSV tự dò delimiter, hỗ trợ XLSX) → chuẩn hóa → khử trùng lặp (MST/domain/tên+địa chỉ) → chấm điểm → lead xuất hiện ở Lead Explorer.
3. Tệp nhập xong chuyển sang `upload/inbox/processed/`, tệp lỗi chuyển sang `failed/` — không nhập lại, không nhân bản.
4. Mỗi tệp = 1 CollectionJob + audit `inbox.file_imported`; nguồn tổng hợp "Hộp thư nhập tự động (upload/inbox)" tự tạo và luôn bật.

Giới hạn an toàn: mỗi tệp tối đa 10MB / 5000 dòng (đồng bộ import upload); tệp khác đuôi `.csv/.xlsx/.xls` bị bỏ qua.

## 9.3. Cào tối đa lead thật (Extractor + đa trang + song song)

Từ bản này, Collector Engine **cào được lead thật** thay vì chỉ ghi nhận nguồn:

1. **Bộ trích xuất chung** (`src/server/extract.ts`): đọc bảng HTML danh bạ (map header tiếng Việt qua alias — "Tên doanh nghiệp/Mã số thuế/Điện thoại..."), không có bảng thì quét khối văn bản theo dấu hiệu DN VN (công ty/tnhh/cổ phần...) + MST theo ngữ cảnh/phone/email; hỗ trợ cả **JSON API** (`OFFICIAL_API` trả JSON → map key qua alias). Chỉ lấy dữ liệu HIỂN THỊ công khai — không bịa khi không parse được.
2. **Cào đa trang (pagination)**: theo link trang kế (`rel="next"`, chữ "Tiếp/Trang sau/»", `?page=N`, `/page/N`) — tối đa `maxPagesPerSource` trang mỗi lần chạy nguồn (mặc định 10, tối đa 100), cùng host, chống lặp nội dung, checkpoint từng trang.
3. **Chạy song song nhiều nguồn**: mỗi vòng pipeline chạy đồng thời `sourceConcurrency` nguồn (mặc định 4, tối đa 8) — mỗi nguồn vẫn giữ nhịp `rateLimitPerMin` của chính nó. Cấu hình tại **Cài đặt → Tự động chạy → Tốc độ thu thập** (API `GET/PUT /api/collector`).
4. **Không phá vỡ đường viền tuân thủ**: vẫn kiểm robots.txt trước mỗi job, dừng an toàn khi nguồn 401/403/429, KHÔNG né CAPTCHA/chống bot — tăng tốc bằng cách khai thác HẾT những gì nguồn cho phép.

**Bot 1 giây cào được tối đa bao nhiêu lead?** Hai mặt của con số (đo thật trên máy bằng `bun run scripts/benchmark-throughput.ts`):

| Mặt | Con số | Ghi chú |
|---|---|---|
| Xử lý thuần (chuẩn hóa + khử trùng lặp + chấm điểm) | **~63.000 lead/giây** | không kẹt DB — giới hạn thực tế là mạng |
| Pipeline đầy đủ + lưu SQLite (batch write + WAL) | **~580 lead/giây** | tối ưu từ 75 → 580 bằng ghi batch |
| Mạng — trần hợp pháp | `nguồn × rateLimit/60 × lead/trang` | VD: 8 nguồn × 60 req/phút × 30 lead/trang ≈ **~240 lead/giây** nếu nguồn cho phép |

Nghĩa là với nguồn danh bạ thông thường, **nút thắt là tốc độ nguồn cho phép (robots.txt + rate limit), không phải bot** — bot xử lý thoải mái gấp cả nghìn lần tốc độ nguồn cho phép. Muốn nhiều lead hơn: bật càng nhiều nguồn đã duyệt càng tốt + tăng `maxPagesPerSource`/`sourceConcurrency`, hoặc dùng kênh inbox (5.000 dòng/tệp, nhập liên tục — ~580 lead/giây).

## 10. Chấm điểm & xem độ bao phủ

- **Thang điểm 0–100** (cấu hình tại Cài đặt): Phù hợp sản phẩm 0–30 · Bằng chứng nhu cầu 0–25 · Phân khúc 0–20 · Khả năng liên hệ 0–15 · Độ mới dữ liệu 0–10. Lưu cấu hình → tự tăng `ruleVersion`; mọi LeadScore lưu kèm phiên bản quy tắc.
- **Phân hạng:** Ưu tiên cao (≥70) · Cần xác minh (≥45 hoặc tin cậy thấp) · Ưu tiên thấp (≥20) · Không phù hợp. Mỗi hạng kèm lý do hiển thị.
- **Sản phẩm A–F:** điểm fit 0–100 riêng từng sản phẩm, tính từ sector match + bằng chứng (HIRING, EXPANSION, MULTI_DEPT, DIGITIZATION_SIGNAL, E_SIGN_SIGNAL…) với hệ số tin cậy.
- **Coverage Dashboard:** theo nguồn/tỉnh/ngành/sản phẩm; tỷ lệ trùng/lỗi/chưa xác minh; phát hiện khoảng trống kèm đề xuất.
- **Không tạo tỷ lệ giả:** % bao phủ thị trường chỉ tính cho phân khúc khai báo `estimatedTotal` kèm `denominatorSource` được tài liệu hóa; nếu không → hiển thị **"Chưa xác định mẫu số bao phủ"**.

## 11. Quy trình tiếp cận Zalo (thủ công bắt buộc)

1. Lead Explorer → mở lead → **Tạo bản nháp** (chọn mẫu theo sản phẩm).
2. Hệ thống render từ dữ liệu thực; **biến thiếu được cảnh báo, không tự điền**.
3. Sửa nội dung (nếu cần) → **Sao chép tin nhắn**.
4. **Mở Zalo Web** → mở `https://chat.zalo.me/` trong tab mới (không truyền dữ liệu gì).
5. Bạn **tự chọn người nhận, tự kiểm tra và gửi** trên Zalo.
6. Quay lại CRM: **Đánh dấu đã liên hệ / Ghi nhận phản hồi / Quan tâm / Lịch theo dõi / Không phù hợp / Không tiếp tục liên hệ / Trả về hàng xác minh**.

Hệ thống **không** có: API gửi tin, tự kết bạn, đọc cookie/token/session Zalo, mô phỏng thao tác. Trạng thái `CONTACTED` chỉ tồn tại khi bạn bấm xác nhận. Lead nằm trong **Danh sách loại trừ** (Settings) không thể tạo draft/task.

## 12. Kiểm thử

```bash
bun run lint             # ESLint
bun run typecheck        # tsc --noEmit
bun run test             # 83 unit tests (normalization, dedup, scoring, templates, connector, csv, policy, discovery, scheduler)
bun run test:integration # 27 asserts E2E (DB riêng tests/db test-int.db)
bun run test:all         # cả hai
```

Ma trận kiểm thử theo spec: **A** chuẩn hóa+khử trùng lặp · **B** connector (robots, retry, policy, không mạng thật) · **C** chấm điểm (biên, giải thích, versioning) · **D** coverage (không tạo % giả) · **E** outreach (template, suppression, quét tĩnh chống auto-send) · **F** audit/sanitize · **G** E2E pipeline · **Discovery** dò nguồn (fetch inject, không giả định cho phép) · **Scheduler** giờ/múi giờ/chống bắn 2 lần.

## 13. Giới hạn & phụ thuộc bên ngoài (trung thực)

- **Chưa tích hợp nguồn bên ngoài nào**: connector webpage có robots-check thật nhưng MVP chưa kèm parser cấu trúc cho danh bạ cụ thể — job sẽ ghi "chưa khai báo bộ phân tích" thay vì bịa dữ liệu. Dò nguồn đã phát hiện thật: nhiều danh bạ phổ biến trả HTTP 403 cho robots.txt (chống bot) → bị ghi nhận trung thực là "cần xem xét thủ công", không né. Khi có nguồn được phép, viết parser trong `src/server/sources/`.
- **Xác thực người dùng**: MVP single-operator; có token guard qua `CRM_API_TOKEN`; NextAuth có thể ghép sau (model `User` đã có).
- **SQLite** phù hợp MVP; chuyển PostgreSQL chỉ cần đổi `provider` + chạy `db:push`.
- **Chưa có worker tách biệt** — job chạy bất đồng bộ trong tiến trình app và scheduler cũng chạy in-process (tick 60s); khi khối lượng lớn, tách worker + cron hệ thống theo kế hoạch modular monolith.
- **Mô hình điểm** là ưu tiên ban đầu — cần kiểm chứng bằng kết quả sales thực tế; chưa có huấn luyện/tự học (chỉ lưu phản hồi + báo cáo).

## 14. Backup, phục hồi, lưu giữ

- SQLite: sao chép tệp `db/custom.db` (dừng ghi hoặc dùng `sqlite3 .backup`). Lịch đề xuất: hằng ngày, giữ 30 bản.
- Phục hồi: thay tệp DB + khởi động lại app. Với PostgreSQL: `pg_dump`/`pg_restore`.
- **Lưu giữ dữ liệu**: `Source.retentionDays` (mặc định 365) — khai báo theo từng nguồn; bật **retentionCleanup** trong Cài đặt → Tự động chạy để scheduler dọn `SourceRecord` quá hạn mỗi ngày.

## 15. Thao tác cho quản trị viên

- **Cài đặt → Chấm điểm**: chỉnh trọng số (tổng phải = 100), ngưỡng hạng, tên người gửi; bấm **Chạy lại chấm điểm**.
- **Cài đặt → Mẫu tin nhắn**: CRUD mẫu theo sản phẩm, dùng biến `{company_name} {business_sector} {product_name} {verified_business_context} {sender_name}`.
- **Cài đặt → Danh sách loại trừ**: thêm MST/phone/email/domain → lead bị chặn khỏi hàng đợi.
- **Cài đặt → Audit log**: theo dõi thao tác (đã sanitize, không chứa dữ liệu liên hệ).
- **Cài đặt → Tự động chạy**: bật lịch hằng ngày, chọn giờ/múi giờ, bật/từng bước tự động (dò nguồn / chạy job / chấm điểm / dọn dữ liệu), xem lần chạy tới + kết quả gần nhất, chạy thử ngay; card **Tốc độ thu thập** (số trang đi sâu mỗi nguồn 1–100, số nguồn chạy song song 1–8, timeout request).
- **Nguồn dữ liệu**: duyệt chính sách truy cập trước khi bật; tự dò nguồn; kiểm soát job.
- **Xóa toàn bộ lead demo**: nút ở Cài đặt (màu đỏ) — xóa sạch lead có đuôi "(demo)" + segment/suppression demo còn sót từ phiên bản cũ; lead thật không bị đụng (API: `POST /api/admin/purge-demo`). Hệ thống CHỈ làm việc với lead thật.

---

## API chính

| Nhóm | Endpoint |
|---|---|
| Lead | `GET/POST /api/companies`, `GET/PATCH /api/companies/[id]`, `POST /api/score` |
| Pipeline | `POST /api/import`, `GET /api/import` (tệp mẫu), `GET /api/export` |
| Nguồn | `GET/POST /api/sources`, `PATCH /api/sources/[id]`, `POST /api/sources/[id]/check` |
| Dò nguồn | `GET /api/discovery` (danh mục ứng viên), `POST /api/discovery` (dò + đăng ký, nguồn mới luôn tắt) |
| Job | `GET/POST /api/jobs`, `POST /api/jobs/[id]` (pause/resume/cancel/retry) |
| Scheduler | `GET /api/scheduler` (trạng thái + lần chạy tới), `PUT` (lưu cấu hình), `POST` (chạy ngay) |
| Chạy liên tục | `GET /api/continuous` (trạng thái realtime), `POST` (`{action:"start"\|"stop"}` — nút START), `PUT` (intervalMinutes 0–720/bộ bước) |
| Hộp thư | (tự động trong pipeline — thả tệp CSV/XLSX vào `upload/inbox/`, không cần gọi API) |
| Bao phủ | `GET /api/coverage` |
| Tiếp cận | `GET/POST /api/outreach`, `POST /api/outreach/draft`, `GET/POST /api/outreach/events` |
| Chiến dịch | `GET/POST /api/campaigns` |
| Mẫu tin | `GET/POST /api/templates`, `PATCH/DELETE /api/templates/[id]` |
| Tuân thủ | `GET/POST/DELETE /api/suppression`, `GET /api/audit` |
| Hệ thống | `GET/PUT /api/settings`, `POST /api/admin/purge-demo` (xóa lead demo), `GET/PUT /api/collector` (tốc độ cào), `GET /api/overview` |

Lỗi trả về thống nhất: `{ ok: false, error: { code, message } }`.
