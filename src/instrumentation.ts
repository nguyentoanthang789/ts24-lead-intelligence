// Khởi động Auto-Run Scheduler + Continuous Runner khi server Next.js bắt đầu
// (chỉ nodejs runtime). Scheduler tick mỗi phút và tự chạy pipeline theo lịch
// cấu hình (mặc định 09:30 Asia/Ho_Chi_Minh). Continuous Runner tự phục hồi
// chế độ "chạy liên tục không nghỉ" nếu trước đó đang bật. KHÔNG tự gửi tin
// nhắn Zalo — gửi tin vẫn 100% thủ công.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { startScheduler } = await import("./server/scheduler");
    startScheduler();
  } catch (err) {
    console.error("[scheduler] khởi động thất bại:", err instanceof Error ? err.message : err);
  }
  try {
    const { resumeContinuousIfNeeded } = await import("./server/continuous");
    await resumeContinuousIfNeeded();
  } catch (err) {
    console.error("[continuous] khởi động thất bại:", err instanceof Error ? err.message : err);
  }
}
