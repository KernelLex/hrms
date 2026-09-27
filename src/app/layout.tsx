import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";

// HANDOVER.md §8.3 — Geist, weights 400/500/600. Nothing heavier.
const geist = Geist({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HRMS",
  applicationName: "HRMS",
  description:
    "Org structure, employee records, time, payroll, recruitment, performance and tax.",
  // Added to an iPhone's home screen, it opens full screen like an app.
  appleWebApp: { capable: true, title: "HRMS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={geist.variable}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
