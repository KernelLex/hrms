import Link from "next/link";

/** Any address that matches no screen at all. Outside the shell, like sign-in. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
            H
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">HRMS</span>
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          There is no page here
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          The address may be mistyped, or the page has moved.
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex h-9 items-center rounded-full bg-ink px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-ink-hover"
        >
          Go to home
        </Link>
      </div>
    </main>
  );
}
