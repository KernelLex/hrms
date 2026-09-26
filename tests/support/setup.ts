import { vi } from "vitest";

/**
 * Server Functions are called directly in tests, outside a request.
 *
 * `cookies()` and `revalidatePath()` both need a request scope that does not
 * exist here, so the session is an HR administrator unless a test says
 * otherwise, and revalidation becomes a no-op. The permission checks themselves still run: `requireRole`
 * is the real implementation, reading the fixed session.
 */
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  const session = {
    userId: 1,
    username: "hr.admin",
    displayName: "Priya Sharma",
    roles: ["HR_ADMIN"] as const,
    employeeId: null,
  };
  // A test can act as someone else for a while: see `actAs` in fixtures.
  const getSession = async () => {
    const current =
      (globalThis as { __testSession?: typeof session }).__testSession ?? session;
    return { ...current, roles: [...current.roles] };
  };
  return {
    ...actual,
    getSession,
    requireSession: getSession,
    requireRole: async (...roles: string[]) => {
      const s = await getSession();
      if (!roles.some((r) => (s.roles as string[]).includes(r))) {
        throw new Error("You do not have permission to do that.");
      }
      return s;
    },
    createSession: async () => {},
    destroySession: async () => {},
  };
});

// `after()` schedules work once a response has gone; with no response here,
// run it straight away so what it writes can be asserted on.
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: (task: Promise<unknown> | (() => unknown)) => {
      void (typeof task === "function" ? task() : task);
    },
  };
});

// Background jobs run when a test says so (`processJobs()`), not behind its
// back: a job racing the test for the one SQLite writer would make results
// depend on timing.
vi.mock("@/lib/jobs/runner", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jobs/runner")>("@/lib/jobs/runner");
  return { ...actual, kickJobs: async () => {} };
});
