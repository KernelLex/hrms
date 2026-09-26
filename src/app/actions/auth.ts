"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { secAppUser, secUserRole, type RoleCode } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";

const SignIn = z.object({
  username: z.string().trim().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

export type SignInState = { error?: string };

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

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await destroySession();
  redirect("/sign-in");
}
