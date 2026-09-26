import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

// HANDOVER.md §8.3 — Geist, weights 400/500/600. Nothing heavier.
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HRMS",
  description:
    "Org structure, employee records, time, payroll, recruitment, performance and tax.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
