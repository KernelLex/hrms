import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Paging for lists that grow with the organisation. The page lives in the URL
 * (`?page=2`) alongside any filters, so a page of results is an address that
 * can be shared, and the server fetches only the rows it shows.
 */

export const PAGE_SIZE = 50;

/** The page number from a search parameter, and the rows to skip for it. */
export function pageFrom(param: string | string[] | undefined, size = PAGE_SIZE) {
  const n = Number(Array.isArray(param) ? param[0] : param);
  const page = Number.isInteger(n) && n > 1 ? n : 1;
  return { page, limit: size, offset: (page - 1) * size };
}

export function Pagination({
  page,
  total,
  size = PAGE_SIZE,
  path,
  params = {},
  noun = "rows",
}: {
  page: number;
  total: number;
  size?: number;
  /** The page's own path, such as "/core-hr". */
  path: string;
  /** Filters to keep while paging. */
  params?: Record<string, string | undefined>;
  /** What is being counted, plural: "employees". */
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size && page === 1) return null;

  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("page", String(p));
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  const first = Math.min(total, (page - 1) * size + 1);
  const last = Math.min(total, page * size);

  const step = (p: number, label: string, icon: React.ReactNode, disabled: boolean) =>
    disabled ? (
      <span
        aria-disabled
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-ink opacity-40 ring-1 ring-control ring-inset [&_svg]:size-4"
      >
        {icon}
        {label}
      </span>
    ) : (
      <Link
        href={href(p)}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-full bg-surface px-3 text-[13px] font-medium text-ink ring-1 ring-control ring-inset",
          "transition-colors duration-150 hover:bg-canvas hover:ring-decor [&_svg]:size-4",
        )}
      >
        {icon}
        {label}
      </Link>
    );

  return (
    <nav
      aria-label="Pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-soft px-6 py-3"
    >
      <p className="tabular text-[13px] text-muted">
        {first.toLocaleString("en-IN")} to {last.toLocaleString("en-IN")} of{" "}
        {total.toLocaleString("en-IN")} {noun}
      </p>
      <div className="flex items-center gap-2">
        {step(page - 1, "Previous", <ChevronLeft />, page <= 1)}
        <span className="tabular text-[13px] text-muted">
          Page {page} of {pages}
        </span>
        {step(page + 1, "Next", <ChevronRight />, page >= pages)}
      </div>
    </nav>
  );
}
