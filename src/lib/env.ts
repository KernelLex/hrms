/**
 * Reads an environment variable, stripping anything that should not be there.
 *
 * Values arrive from many places — .env files, `vercel env add`, CI secrets —
 * and several of those can attach a UTF-8 BOM or trailing whitespace. A BOM is
 * invisible in every dashboard and log, so the resulting failure is opaque:
 * the Turso URL once arrived as "﻿libsql://…" and the client rejected it
 * as malformed with no clue why. Strip it here, once, for everyone.
 */
export function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/^﻿/, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export function requireEnv(name: string, hint?: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} is not set.${hint ? ` ${hint}` : ""}`);
  }
  return value;
}
