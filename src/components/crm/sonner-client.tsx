"use client";
// Toaster của sonner cần client component riêng
import { Toaster } from "@/components/ui/sonner";

export function SonnerToaster() {
  return <Toaster position="top-right" richColors />;
}
