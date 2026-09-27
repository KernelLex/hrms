/**
 * Errors as RFC 9457 problem details: a stable machine `code` the client's
 * code can switch on, and a sentence a person can act on.
 */

export const PROBLEM_TYPES = {
  invalid_token: "The access token is missing, expired or not valid. Take a new one at /oauth/token.",
  invalid_client: "The client id or secret is wrong, or the client is suspended.",
  insufficient_scope: "The token does not carry a scope this call needs.",
  forbidden_ip: "Calls from this address are not allowed for this client.",
  not_found: "Nothing exists at this address, or it is outside the companies the client may see.",
  method_not_allowed: "This address does not take that method.",
  invalid_request: "A query parameter or header is missing or malformed.",
  validation_failed: "The body did not pass the same checks the screens apply.",
  owned_by_hrms: "This record or field is owned by the HRMS; only the HRMS writes it.",
  owned_by_erp: "This record or field is owned by the ERP; the HRMS does not write it.",
  precondition_failed: "The record changed since you read it (If-Match did not match). Read it again and retry.",
  conflict: "The request conflicts with the record's current state.",
  idempotency_key_reused: "This Idempotency-Key was used before with a different request.",
  idempotency_in_progress: "A request with this Idempotency-Key is still being handled. Retry shortly.",
  rate_limited: "Too many requests. Wait for the number of seconds in Retry-After.",
  internal_error: "Something went wrong on our side. Retry with the same Idempotency-Key; if it persists, send the request id to HR.",
} as const;

export type ProblemCode = keyof typeof PROBLEM_TYPES;

/** The status each code comes with, for the documentation. */
export const PROBLEM_STATUS: Record<ProblemCode, number> = {
  invalid_token: 401,
  invalid_client: 401,
  insufficient_scope: 403,
  forbidden_ip: 403,
  not_found: 404,
  method_not_allowed: 405,
  invalid_request: 400,
  validation_failed: 422,
  owned_by_hrms: 409,
  owned_by_erp: 409,
  precondition_failed: 412,
  conflict: 409,
  idempotency_key_reused: 422,
  idempotency_in_progress: 409,
  rate_limited: 429,
  internal_error: 500,
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    readonly detail?: string,
    readonly errors?: { path: string; message: string }[],
    readonly headers?: Record<string, string>,
  ) {
    super(detail ?? PROBLEM_TYPES[code]);
    this.name = "ApiError";
  }
}

export const notFound = (detail?: string) => new ApiError(404, "not_found", detail);
export const invalid = (detail: string, errors?: { path: string; message: string }[]) =>
  new ApiError(422, "validation_failed", detail, errors);

/** `type` is a page that explains the code: /developers/errors on this host. */
export function problemBody(err: ApiError, correlationId: string, origin: string) {
  return {
    type: `${origin}/developers/errors#${err.code}`,
    title: PROBLEM_TYPES[err.code],
    status: err.status,
    code: err.code,
    detail: err.detail ?? PROBLEM_TYPES[err.code],
    request_id: correlationId,
    ...(err.errors ? { errors: err.errors } : {}),
  };
}
