"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Toasts — DESIGN_LANGUAGE.md §9.
 *
 * Bottom centre, 24px from the edge, above open dialogs. Ink pill, white 13px
 * weight 500. Errors use a danger fill. Each leaves after 3.5 seconds and is
 * announced to screen readers as a status. Wording is one short past-tense
 * sentence — "Company saved", not "Success!".
 */

type Toast = { id: number; message: string; problem?: boolean };

const ToastContext = React.createContext<(message: string, problem?: boolean) => void>(
  () => {},
);

export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const show = React.useCallback((message: string, problem = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, problem }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/*
        No mounted guard is needed: the list starts empty, so the server and
        the first client render both produce nothing, and it only fills after
        a client interaction — by which point document exists.
      */}
      {toasts.length > 0
        ? createPortal(
            <div
              role="status"
              aria-live="polite"
              className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2"
            >
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    "rounded-full px-4 py-2.5 text-[13px] font-medium text-white shadow-toast",
                    t.problem ? "bg-danger" : "bg-ink",
                  )}
                >
                  {t.message}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
