"use client";
// TS24 Lead Intelligence — Ứng dụng quản trị lead (SPA: sidebar điều hướng 6 trang)
import { useState } from "react";
import {
  LayoutDashboard, Users, Database, PieChart, SendHorizonal, Settings, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OverviewView } from "@/components/crm/overview-view";
import { LeadsView } from "@/components/crm/leads-view";
import { SourcesView } from "@/components/crm/sources-view";
import { CoverageView } from "@/components/crm/coverage-view";
import { OutreachView } from "@/components/crm/outreach-view";
import { SettingsView } from "@/components/crm/settings-view";

const NAV = [
  { id: "overview", label: "Tổng quan", icon: LayoutDashboard },
  { id: "leads", label: "Lead Explorer", icon: Users },
  { id: "sources", label: "Nguồn dữ liệu", icon: Database },
  { id: "coverage", label: "Độ bao phủ", icon: PieChart },
  { id: "outreach", label: "Tiếp cận & Zalo", icon: SendHorizonal },
  { id: "settings", label: "Cài đặt & Audit", icon: Settings },
] as const;

type ViewId = (typeof NAV)[number]["id"];

export default function Home() {
  const [view, setView] = useState<ViewId>("overview");

  return (
    <div className="min-h-screen flex flex-col bg-stone-50">
      <header className="border-b bg-white sticky top-0 z-20">
        <div className="mx-auto max-w-7xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-600 text-white grid place-items-center font-bold text-sm">TS</div>
            <div>
              <div className="font-bold leading-tight">TS24 Lead Intelligence</div>
              <div className="text-[11px] text-muted-foreground leading-tight">Tìm kiếm · Đánh giá · Tiếp cận khách hàng tiềm năng</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Tiếp cận Zalo là thủ công — hệ thống không tự gửi tin
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl w-full px-4 flex-1 flex flex-col md:flex-row gap-6 py-6">
        <nav aria-label="Điều hướng chính" className="md:w-56 shrink-0">
          <ul className="flex md:flex-col gap-1 overflow-x-auto md:sticky md:top-20">
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  onClick={() => setView(item.id)}
                  aria-current={view === item.id ? "page" : undefined}
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition whitespace-nowrap ${
                    view === item.id
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "text-stone-600 hover:bg-stone-100"
                  }`}
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block mt-6 rounded-xl border bg-white p-3 text-[11px] leading-relaxed text-muted-foreground">
            <b className="text-stone-700">Nguyên tắc MVP</b><br />
            Tự động hóa: thu thập, chuẩn hóa, khử trùng lặp, chấm điểm, soạn nội dung.<br />
            Người dùng tự làm: chọn người nhận &amp; gửi tin trên Zalo Web.
          </div>
        </nav>

        <main className="flex-1 min-w-0">
          {view === "overview" && <OverviewView onGoTo={(v) => setView(v as ViewId)} />}
          {view === "leads" && <LeadsView />}
          {view === "sources" && <SourcesView />}
          {view === "coverage" && <CoverageView />}
          {view === "outreach" && <OutreachView />}
          {view === "settings" && <SettingsView />}
        </main>
      </div>

      <footer className="border-t bg-white mt-auto">
        <div className="mx-auto max-w-7xl px-4 py-3 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>TS24 Lead Intelligence — MVP modular monolith · Next.js 16 · Prisma</span>
          <span>Dữ liệu demo là tổng hợp, không phải khách hàng thật</span>
        </div>
      </footer>
    </div>
  );
}
