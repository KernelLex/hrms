"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  X,
  ChevronDown,
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
  FileBadge,
  CircleUser,
  CalendarRange,
  ChartBar,
  Search,
  Bell,
  History,
  Mail,
  ShieldCheck,
  Workflow,
  Plug,
  CalendarClock,
  Globe,
  UserCheck,
  ListChecks,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui";
import { ShortcutHint, useCommandMenu } from "@/components/command-menu";
import type { NavGroup } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  CircleUser,
  CalendarRange,
  ChartBar,
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
  FileBadge,
  History,
  Mail,
  ShieldCheck,
  Workflow,
  Plug,
  CalendarClock,
  Globe,
  UserCheck,
  ListChecks,
  Users2,
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

/* ----------------------------------------------------------- search button */

/** §8.9 Sidebar: a 36px soft search button reading "Search", with the shortcut. */
function SearchButton() {
  const open = useCommandMenu();
  return (
    <button
      type="button"
      onClick={open}
      className="flex h-9 w-full items-center gap-2.5 rounded-xl bg-soft px-3 text-sm text-secondary transition-colors duration-150 hover:text-ink"
    >
      <Search className="size-4 shrink-0 stroke-[1.75] text-muted" aria-hidden />
      <span className="flex-1 text-left">Search</span>
      <ShortcutHint />
    </button>
  );
}

function SearchIconButton() {
  const open = useCommandMenu();
  return (
    <button
      type="button"
      onClick={open}
      aria-label="Search"
      title="Search"
      className="flex size-10 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-soft"
    >
      <Search className="size-5 stroke-[1.75]" />
    </button>
  );
}

/* -------------------------------------------------------------------- bell */

/**
 * Notifications, with the unread count as a §8.9 count pill: ink, at least
 * 20px wide, white 11px tabular figures.
 */
function BellLink({ unread, onNavigate }: { unread: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === "/inbox" || pathname.startsWith("/inbox/");
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Link
      href="/inbox"
      onClick={onNavigate}
      aria-label={label}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex size-10 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-soft",
        active && "bg-soft",
      )}
    >
      <Bell className="size-5 stroke-[1.75]" />
      {unread > 0 ? (
        <span
          aria-hidden
          className="tabular absolute top-0.5 right-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-medium text-white"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

/* ---------------------------------------------------------------- nav list */

/*
 * Which groups someone has opened or folded, remembered in their browser. A
 * convenience only: without storage (a private window, say) it lives in
 * memory for the visit, and the sidebar works the same.
 */
const NAV_KEY = "hrms.nav.groups";
const navListeners = new Set<() => void>();
let navMemory = "{}";

function readNavGroups(): string {
  try {
    return window.localStorage.getItem(NAV_KEY) ?? navMemory;
  } catch {
    return navMemory;
  }
}

function writeNavGroups(next: Record<string, boolean>) {
  navMemory = JSON.stringify(next);
  try {
    window.localStorage.setItem(NAV_KEY, navMemory);
  } catch {
    // storage refused: memory still holds it
  }
  navListeners.forEach((l) => l());
}

function subscribeNavGroups(listener: () => void) {
  navListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    navListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const parseNavGroups = (raw: string): Record<string, boolean> => {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/**
 * The sidebar's groups fold, so a long list stays short: the group holding
 * the current page opens itself, the rest stay as they were left.
 */
function NavList({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const idBase = React.useId();
  // The server has no stored choices, so the first render matches it.
  const stored = React.useSyncExternalStore(subscribeNavGroups, readNavGroups, () => "{}");
  const prefs = React.useMemo(() => parseNavGroups(stored), [stored]);
  const activeGroup = groups.find((g) => g.items.some((i) => isActive(pathname, i.href)))?.label ?? null;

  // Arriving at a page opens its group, even one folded earlier.
  React.useEffect(() => {
    if (!activeGroup) return;
    const current = parseNavGroups(readNavGroups());
    if (current[activeGroup] === false) writeNavGroups({ ...current, [activeGroup]: true });
  }, [activeGroup]);

  return (
    <nav className="flex flex-col gap-3">
      {groups.map((group, n) => {
        const open = prefs[group.label] ?? group.label === activeGroup;
        const listId = `${idBase}-group-${n}`;
        return (
          <div key={group.label}>
            <button
              type="button"
              onClick={() => writeNavGroups({ ...parseNavGroups(readNavGroups()), [group.label]: !open })}
              aria-expanded={open}
              aria-controls={listId}
              className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink"
            >
              <span>{group.label}</span>
              <ChevronDown
                aria-hidden
                className={cn("size-3.5 shrink-0 stroke-[1.75] transition-transform duration-150", !open && "-rotate-90")}
              />
            </button>
            <ul id={listId} hidden={!open} className="mt-1 flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon] ?? Users;
                const active = isActive(pathname, item.href);
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
        );
      })}
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
  unread,
  signOutAction,
  children,
}: {
  groups: NavGroup[];
  name: string;
  role: string;
  /** Unread notifications, for the bell. */
  unread: number;
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
      {/* §8.13 — keyboard users skip the navigation on every page */}
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface lg:flex print:hidden">
        <div className="flex items-center justify-between py-3.5 pr-3 pl-5">
          <Brand />
          <BellLink unread={unread} />
        </div>
        <div className="px-4 pb-5">
          <SearchButton />
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          <NavList groups={groups} />
        </div>
        <SidebarFooter name={name} role={role} signOutAction={signOutAction} />
      </aside>

      {/* Mobile top bar — 56px, sticky, translucent with a hairline under */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-5 backdrop-blur-xl lg:hidden print:hidden">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
          className="flex size-10 items-center justify-center rounded-lg text-ink transition-colors duration-150 hover:bg-soft"
        >
          <Menu className="size-5 stroke-[1.75]" />
        </button>
        <Brand />
        <div className="ml-auto flex items-center gap-1">
          <BellLink unread={unread} />
          <SearchIconButton />
        </div>
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
      <main id="main" className="lg:pl-60 print:pl-0">
        <div className="mx-auto max-w-[1180px] px-5 pt-8 pb-16 sm:px-8 lg:px-12 lg:pt-12 print:max-w-none print:p-0">
          {children}
        </div>
      </main>
    </div>
  );
}
