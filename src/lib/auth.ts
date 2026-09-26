import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import type { RoleCode } from "@/db/schema";

/**
 * Prototype authentication: a signed session cookie.
 *
 * Deliberately not Auth.js — this app has one credentials provider, seeded
 * users and three fixed roles, so a JWT cookie is the whole requirement and
 * keeps the session shape under our control.
 */

const COOKIE = "hrms_session";
const MAX_AGE_SECONDS = 60 * 60 * 8; // one working day

export type Session = {
  userId: number;
  username: string;
  displayName: string;
  roles: RoleCode[];
  employeeId: number | null;
};

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set.");
  return new TextEncoder().encode(s);
}

export async function createSession(session: Session): Promise<void> {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      userId: payload.userId as number,
      username: payload.username as string,
      displayName: payload.displayName as string,
      roles: payload.roles as RoleCode[],
      employeeId: (payload.employeeId as number | null) ?? null,
    };
  } catch {
    return null;
  }
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/* ----------------------------------------------------------- authorisation */

export function hasRole(session: Session | null, ...roles: RoleCode[]): boolean {
  if (!session) return false;
  return roles.some((r) => session.roles.includes(r));
}

/**
 * Server Functions are reachable by direct POST, not only through the UI, so
 * every mutation calls this rather than trusting the page that rendered it.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  return session;
}

export async function requireRole(...roles: RoleCode[]): Promise<Session> {
  const session = await requireSession();
  if (!hasRole(session, ...roles)) {
    throw new Error("You do not have permission to do that.");
  }
  return session;
}

export const COOKIE_NAME = COOKIE;
