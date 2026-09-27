import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * The API's conventions in code: money as a decimal string with its
 * currency, dates as `YYYY-MM-DD`, cursors that page by id, ETags, and
 * `?fields=`.
 */

/** `{"amount": "72000.00", "currency": "INR"}` — never a float. */
export function money(paise: number | null | undefined, currency = "INR") {
  if (paise === null || paise === undefined) return null;
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return { amount: `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`, currency };
}

export const Money = z
  .object({
    amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, "An amount is a decimal string with at most two places, such as \"72000.00\"."),
    currency: z.literal("INR"),
  })
  .meta({ id: "Money", description: "An amount of money: a decimal string and its currency. Never a number." });

/** Paise from a Money object, exactly. */
export function toPaiseExact(m: { amount: string }): number {
  const [whole, frac = ""] = m.amount.replace("-", "").split(".");
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return m.amount.startsWith("-") ? -paise : paise;
}

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD.")
  .meta({ description: "A date, YYYY-MM-DD." });

/** The open-ended date sentinel becomes null on the wire. */
export const until = (d: string | null | undefined) => (!d || d === "9999-12-31" ? null : d);

/* ---------------------------------------------------------------- paging */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export function encodeCursor(id: number | string): string {
  return Buffer.from(String(id)).toString("base64url");
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  const n = Number(Buffer.from(cursor, "base64url").toString());
  return Number.isFinite(n) ? n : 0;
}

export const PageQuery = {
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional().meta({ description: `Up to ${MAX_LIMIT}; ${DEFAULT_LIMIT} by default.` }),
  cursor: z.string().optional().meta({ description: "The `next_cursor` from the previous page." }),
  fields: z.string().optional().meta({ description: "Comma-separated top-level fields to return, such as `id,employee_number,personal`." }),
};

/** A page of rows fetched one past the limit, so we know whether more exist. */
export function page<T extends { id: number | string }>(rows: T[], limit: number, cursorOf: (row: T) => number | string = (r) => r.id) {
  const more = rows.length > limit;
  const data = more ? rows.slice(0, limit) : rows;
  return { data, next_cursor: more ? encodeCursor(cursorOf(data[data.length - 1])) : null };
}

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    next_cursor: z.string().nullable().meta({ description: "Pass as `cursor` for the next page; null on the last page." }),
  });
}

/** Keeps only the requested top-level fields (and always the key: `id` or `code`). */
export function pickFields<T extends Record<string, unknown>>(row: T, fields: string | undefined): Partial<T> {
  if (!fields) return row;
  const wanted = new Set(fields.split(",").map((f) => f.trim()).filter(Boolean));
  wanted.add("id");
  wanted.add("code");
  return Object.fromEntries(Object.entries(row).filter(([k]) => wanted.has(k))) as Partial<T>;
}

/* ----------------------------------------------------------------- ETags */

/** A weak ETag over a record's representation: it changes when the record does. */
export function etagOf(value: unknown): string {
  const hash = createHash("sha1").update(JSON.stringify(value)).digest("base64url").slice(0, 16);
  return `W/"${hash}"`;
}

/** Stable JSON for hashing requests: keys sorted. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
