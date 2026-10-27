// Khởi động Auto-Run Scheduler khi server Next.js bắt đầu (chỉ nodejs runtime).
// Scheduler tick mỗi phút và tự chạy pipeline dữ liệu theo lịch cấu hình
// (mặc định 09:30 Asia/Ho_Chi_Minh) — KHÔNG tự gửi tin nhắn Zalo.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  } catch (err) {
    console.error("[scheduler] khởi động thất bại:", err instanceof Error ? err.message : err);
  }
}
