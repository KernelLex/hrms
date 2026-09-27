import Link from "next/link";
import type { Metadata } from "next";
import { rawClient } from "@/lib/db";

/**
 * The public careers site: open roles, and applying for one. No sign-in, no
 * app shell — this is what candidates outside the company see.
 */

export const metadata: Metadata = {
  title: "Careers",
  description: "Open roles, and how to apply.",
};

export const dynamic = "force-dynamic";

export default async function CareersLayout({ children }: { children: React.ReactNode }) {
  const company = (await rawClient().execute("SELECT name FROM om_company ORDER BY code LIMIT 1")).rows[0];
  const name = company ? String(company.name) : "Careers";
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-[1040px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/careers" className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">{name}</span>
          </Link>
          <span className="shrink-0 text-[13px] text-muted">Careers</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1040px] px-4 py-10 sm:px-6 sm:py-14">{children}</main>
      <footer className="mx-auto max-w-[1040px] px-4 pb-10 text-xs text-muted sm:px-6">
        We use what you send only to consider you for the role you apply for.
      </footer>
    </div>
  );
}
