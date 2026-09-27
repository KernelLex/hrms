import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "@/lib/api";
import { EVENT_TYPES } from "@/lib/api/events";
import { PROBLEM_STATUS, PROBLEM_TYPES } from "@/lib/api/problem";
import { SCOPES } from "@/lib/api/scopes";
import { endpointReference, withReference } from "@/lib/api/reference";

/**
 * API.md's reference section — scopes, event types, error codes and every
 * endpoint — is generated from the code. This fails when the two differ;
 * `npm run api:docs` rewrites the section.
 */

const FILE = path.resolve(import.meta.dirname, "../API.md");

describe("API.md", () => {
  it("has the reference the code would generate", () => {
    const current = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
    const reference = endpointReference(ENDPOINTS, { scopes: SCOPES, events: EVENT_TYPES, problems: PROBLEM_TYPES, statuses: PROBLEM_STATUS });
    const expected = withReference(current, reference);
    if (process.env.UPDATE_API_DOCS === "1") {
      writeFileSync(FILE, expected);
      return;
    }
    expect(current === expected, "API.md's reference is out of date: run npm run api:docs").toBe(true);
  });
});
