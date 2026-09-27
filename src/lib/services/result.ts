/**
 * What a service returns: the value, or a sentence for the person or system
 * that asked, with an optional code the API turns into a problem type.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok?: undefined; error: string; code?: "not_found" | "conflict" | "owned_by_hrms" | "owned_by_erp" };
