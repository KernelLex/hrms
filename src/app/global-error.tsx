"use client";

import "./globals.css";

/**
 * The last resort, when the root layout itself fails. It replaces the whole
 * document, so it carries its own <html> and <body> and cannot use the shell.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <title>HRMS could not start</title>
        <main
          data-error-boundary
          className="flex min-h-screen items-center justify-center px-5 py-12"
        >
          <div className="w-full max-w-[380px]">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
              HRMS could not start
            </h1>
            <p className="mt-1 text-[15px] text-muted">
              Something failed before any screen could load. Trying again usually fixes it.
            </p>
            {error.digest ? (
              <p className="mt-3 text-[13px] text-muted">
                Reference <span className="tabular text-ink">{error.digest}</span>
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => retry()}
              className="mt-7 inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-ink-hover"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
