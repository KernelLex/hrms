"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Loader2,
  CornerDownLeft,
  Network,
  Users,
  CalendarDays,
  CalendarCheck,
  Inbox,
  Banknote,
  ReceiptText,
  FileText,
  UserPlus,
  UserCheck,
  Target,
  ClipboardCheck,
  FileBadge,
  CircleUser,
  CalendarRange,
  ChartBar,
  Briefcase,
  House,
  User,
  Bell,
  History,
  Mail,
  ShieldCheck,
  Workflow,
  Plug,
  CalendarClock,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { matches, type Command } from "@/lib/commands";
import { searchPeople, type PersonHit } from "@/app/actions/search";

/**
 * Command menu — HANDOVER.md §8.9.
 *
 * Ctrl K (⌘K on a Mac) from anywhere, or the sidebar's search button. Centred,
 * 512px, 14% down the screen. Actions first, then pages, then people once two
 * characters are typed. Arrow keys move, Enter opens, Esc closes.
 *
 * Built on the platform <dialog> so focus stays inside, and on the ARIA
 * combobox pattern so a screen reader follows the highlighted row (§8.13).
 */

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
  UserCheck,
  Target,
  ClipboardCheck,
  FileBadge,
  Briefcase,
  House,
  Bell,
  History,
  Mail,
  ShieldCheck,
  Workflow,
  Plug,
  CalendarClock,
  Globe,
};

type Item = {
  key: string;
  group: "Actions" | "Pages" | "People";
  label: string;
  detail?: string;
  href: string;
  Icon: LucideIcon;
  hint: string;
};

const OpenContext = React.createContext<() => void>(() => {});

/** Opens the command menu, for the sidebar and top-bar search buttons. */
export function useCommandMenu() {
  return React.useContext(OpenContext);
}

export function CommandMenuProvider({
  actions,
  pages,
  canSearchPeople,
  children,
}: {
  actions: Command[];
  pages: Command[];
  canSearchPeople: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();

  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [people, setPeople] = React.useState<PersonHit[]>([]);
  const [searching, setSearching] = React.useState(false);

  const show = React.useCallback(() => {
    setQuery("");
    setActive(0);
    setPeople([]);
    setOpen(true);
  }, []);
  const close = React.useCallback(() => setOpen(false), []);

  // Ctrl K / ⌘K from anywhere, including inside form fields.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (dialogRef.current?.open) setOpen(false);
        else show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  React.useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      inputRef.current?.focus();
    }
    if (!open && el.open) el.close();
  }, [open]);

  // People search, debounced so each keystroke is not a request.
  const trimmed = query.trim();
  const wantsPeople = canSearchPeople && trimmed.length >= 2;
  React.useEffect(() => {
    if (!wantsPeople) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchPeople(trimmed);
        if (!cancelled) setPeople(hits);
      } catch {
        if (!cancelled) setPeople([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, wantsPeople]);

  const items: Item[] = React.useMemo(() => {
    const toItem = (group: Item["group"], hint: string) => (c: Command): Item => ({
      key: `${group}:${c.href}:${c.label}`,
      group,
      label: c.label,
      href: c.href,
      Icon: ICONS[c.icon] ?? FileText,
      hint,
    });
    const actionItems = actions.filter((c) => matches(c, query)).map(toItem("Actions", "Open"));
    const matchedPages = pages.filter((c) => matches(c, query));
    // With nothing typed, a short list; the rest are one word away.
    const pageItems = (trimmed ? matchedPages : matchedPages.slice(0, 8)).map(
      toItem("Pages", "Go to"),
    );
    const peopleItems: Item[] = wantsPeople
      ? [
          ...people.map((p) => ({
            key: `People:${p.id}`,
            group: "People" as const,
            label: p.name,
            detail: p.detail,
            href: p.href,
            Icon: User,
            hint: "Open",
          })),
          {
            key: "People:search",
            group: "People" as const,
            label: `Search for “${trimmed}”`,
            detail: "In the employee list",
            href: `/core-hr?q=${encodeURIComponent(trimmed)}`,
            Icon: Search,
            hint: "Search",
          },
        ]
      : [];
    return [...actionItems, ...pageItems, ...peopleItems];
  }, [actions, pages, people, query, trimmed, wantsPeople]);

  const current = Math.min(active, Math.max(0, items.length - 1));

  React.useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const go = (item: Item | undefined) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(1, items.length));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[current]);
    }
  };

  const optionId = (i: number) => `${listId}-option-${i}`;

  return (
    <OpenContext.Provider value={show}>
      {children}
      <dialog
        ref={dialogRef}
        data-command-menu
        aria-label="Command menu"
        onClose={close}
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === dialogRef.current) close();
        }}
        className="mx-auto mt-[14vh] mb-auto w-[calc(100vw-32px)] max-w-[512px] overflow-hidden rounded-2xl bg-surface p-0 text-ink shadow-menu ring-1 ring-black/5"
      >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex h-[52px] items-center gap-3 border-b border-line px-4">
            {searching ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-muted" aria-hidden />
            ) : (
              <Search className="size-4 shrink-0 stroke-[1.75] text-faint" aria-hidden />
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                if (e.target.value.trim().length < 2) setPeople([]);
              }}
              onKeyDown={onKeyDown}
              placeholder={canSearchPeople ? "Search pages, actions and people" : "Search pages and actions"}
              aria-label="Search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={items.length ? optionId(current) : undefined}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint focus-visible:outline-none"
            />
            <kbd className="hidden rounded-md px-1.5 py-0.5 text-[11px] text-muted ring-1 ring-control sm:block">
              Esc
            </kbd>
          </div>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Results"
            className="max-h-[min(60vh,420px)] overflow-y-auto p-2"
          >
            {items.length === 0 ? (
              <li className="px-3 py-8 text-center text-[13px] text-muted" role="presentation">
                Nothing matches “{trimmed}”.
              </li>
            ) : (
              items.map((item, i) => {
                const firstOfGroup = i === 0 || items[i - 1].group !== item.group;
                return (
                  <React.Fragment key={item.key}>
                    {firstOfGroup ? (
                      <li
                        role="presentation"
                        className={cn("px-3 pb-1 text-xs text-muted", i === 0 ? "pt-1" : "pt-3")}
                      >
                        {item.group}
                      </li>
                    ) : null}
                    <li
                      id={optionId(i)}
                      role="option"
                      aria-selected={i === current}
                      data-index={i}
                      onMouseMove={() => i !== current && setActive(i)}
                      onClick={() => go(item)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5",
                        i === current && "bg-soft",
                      )}
                    >
                      <item.Icon className="size-4 shrink-0 stroke-[1.75] text-muted" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{item.label}</span>
                        {item.detail ? (
                          <span className="block truncate text-xs text-muted">{item.detail}</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                        {item.hint}
                        {i === current ? <CornerDownLeft className="size-3" aria-hidden /> : null}
                      </span>
                    </li>
                  </React.Fragment>
                );
              })
            )}
          </ul>
        </div>
      </dialog>
    </OpenContext.Provider>
  );
}

const subscribe = () => () => {};

/** "Ctrl K", or "⌘K" on a Mac. Server-rendered as Ctrl K, corrected on the client. */
export function ShortcutHint({ className }: { className?: string }) {
  const isMac = React.useSyncExternalStore(
    subscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  return (
    <kbd
      className={cn(
        "rounded-md bg-surface px-1.5 py-0.5 font-sans text-[11px] text-muted ring-1 ring-control",
        className,
      )}
    >
      {isMac ? "⌘K" : "Ctrl K"}
    </kbd>
  );
}
