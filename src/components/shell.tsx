"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  LogOut,
  Network,
  Users,
  CalendarDays,
  CalendarCheck,
  Inbox,
  Banknote,
  ReceiptText,
  FileText,
  UserPlus,
  Target,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import type { NavGroup } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  Network,
  Users,
  CalendarDays,
  CalendarCheck,
  Inbox,
  Banknote,
  ReceiptText,
  FileText,
  UserPlus,
  Target,
  ClipboardCheck,
};

/* -------------------------------------------------------------- brand mark */

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
        H
      </span>
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
        HRMS
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- nav list */

function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-2 text-xs text-faint">{group.label}</div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon] ?? Users;
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
                      active
                        ? "bg-soft font-medium text-ink"
                        : "text-secondary hover:bg-canvas",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-[18px] shrink-0 stroke-[1.75]",
                        active ? "text-ink" : "text-faint",
                      )}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ footer */

function SidebarFooter({
  name,
  role,
  signOutAction,
}: {
  name: string;
  role: string;
  signOutAction: () => Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-5 py-4">
      <Avatar name={name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-ink">{name}</div>
        <div className="truncate text-xs text-muted">{role}</div>
      </div>
      <form action={signOutAction}>
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors duration-150 hover:bg-soft hover:text-ink"
        >
          <LogOut className="size-4 stroke-[1.75]" />
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------- shell */

export function Shell({
  groups,
  name,
  role,
  signOutAction,
  children,
}: {
  groups: NavGroup[];
  name: string;
  role: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes, including on back/forward.
  // Adjusting state during render is the supported pattern here; doing this in
  // an effect would render the drawer open for a frame first.
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setDrawerOpen(false);
  }

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 py-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <NavList groups={groups} />
        </div>
        <SidebarFooter name={name} role={role} signOutAction={signOutAction} />
      </aside>

      {/* Mobile top bar — 56px, sticky, translucent with a hairline under */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-5 backdrop-blur-xl lg:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-soft"
        >
          <Menu className="size-5 stroke-[1.75]" />
        </button>
        <Brand />
      </header>

      {/* Mobile drawer — 288px behind a 30% scrim */}
      {drawerOpen ? (
        <div className="lg:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 z-40 bg-black/30"
          />
          <div className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-surface shadow-dialog">
            <div className="flex items-center justify-between px-5 py-5">
              <Brand />
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
                className="flex size-8 items-center justify-center rounded-lg text-faint transition-colors duration-150 hover:bg-soft hover:text-ink"
              >
                <X className="size-4 stroke-[1.75]" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              <NavList groups={groups} onNavigate={() => setDrawerOpen(false)} />
            </div>
            <SidebarFooter name={name} role={role} signOutAction={signOutAction} />
          </div>
        </div>
      ) : null}

      {/* Content column — up to 1180px, centred */}
      <main className="lg:pl-60">
        <div className="mx-auto max-w-[1180px] px-5 pt-8 pb-16 sm:px-8 lg:px-12 lg:pt-12">
          {children}
        </div>
      </main>
    </div>
  );
}
