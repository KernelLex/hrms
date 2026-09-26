"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog — DESIGN_LANGUAGE.md §9.
 *
 * Uses the platform `<dialog>` element so focus stays inside and Esc closes it
 * (§13). 448px, or 672px for complex forms; on phones the screen width minus
 * 32px. 24px radius, floating shadow, scrim and entrance motion come from
 * globals.css.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  wide = false,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  wide?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Clicking the backdrop (the dialog element itself) closes it.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100vw-32px)] rounded-3xl bg-surface p-0 text-ink shadow-dialog backdrop:bg-transparent",
        wide ? "max-w-[672px]" : "max-w-[448px]",
      )}
    >
      {/* Inner wrapper so the backdrop click test above is unambiguous. */}
      <div onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 p-6 pb-4">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[13px] text-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors duration-150 hover:bg-soft hover:text-ink"
          >
            <X className="size-4 stroke-[1.75]" />
          </button>
        </div>

        <div className="max-h-[75vh] overflow-y-auto px-6">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 p-6 pt-5">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}
