"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { secAppUser, secUserRole, type RoleCode } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";
import { DEMO_ACCOUNTS, demoSignInEnabled } from "@/lib/demo";

const SignIn = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

export type SignInState = { error?: string };

type User = typeof secAppUser.$inferSelect;

async function startSession(user: User): Promise<void> {
  const roleRows = await db
    .select({ roleCode: secUserRole.roleCode })
    .from(secUserRole)
    .where(eq(secUserRole.userId, user.id));

  await createSession({
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: roleRows.map((r) => r.roleCode as RoleCode),
    employeeId: user.employeeId,
  });
}

export async function signInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = SignIn.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const { username, password } = parsed.data;

  const user = await db.query.secAppUser.findFirst({
    where: eq(secAppUser.username, username),
  });

  // Same message either way, so the form does not reveal which usernames exist.
  const invalid = { error: "That username and password do not match." };
  if (!user || !user.isActive) return invalid;

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return invalid;

  await startSession(user);
  redirect("/");
}

/**
 * One click into a demo account, with no password.
 *
 * This is a prototype whose demo password is printed on the sign-in page, so
 * asking for it protects nothing and slows every walkthrough down. The action
 * still refuses any username outside the three seeded demo accounts — it is
 * reachable by direct POST like every Server Function, so the allowlist is
 * enforced here rather than trusted to the page — and it can be switched off
 * with DEMO_SIGN_IN=off once real accounts exist.
 */
export async function demoSignInAction(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  if (!demoSignInEnabled()) {
    return { error: "One-click sign-in is switched off. Sign in with a password." };
  }

  const username = String(formData.get("username") ?? "");
  if (!DEMO_ACCOUNTS.some((a) => a.username === username)) {
    return { error: "That is not a demo account." };
  }

  const user = await db.query.secAppUser.findFirst({
    where: eq(secAppUser.username, username),
  });
  if (!user || !user.isActive) {
    return { error: "That demo account is missing. Run npm run db:seed to restore it." };
  }

  await startSession(user);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}
