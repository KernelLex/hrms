import "server-only";
import { z } from "zod";
import { createRouter, type Endpoint } from "./router";
import { buildOpenApi } from "./openapi";
import { integrationEndpoints } from "./resources/integration";
import { employeeEndpoints } from "./resources/employees";
import { lifecycleEndpoints } from "./resources/lifecycle";
import { correctionEndpoints } from "./resources/corrections";
import { orgEndpoints } from "./resources/org";
import { headcountEndpoints } from "./resources/headcount";
import { importEndpoints } from "./resources/imports";
import { timeEndpoints } from "./resources/time";
import { attendanceEndpoints } from "./resources/attendance";
import { payrollEndpoints } from "./resources/payroll";
import { loansClaimsEndpoints } from "./resources/loans-claims";
import { otherEndpoints } from "./resources/other";

/**
 * Every endpoint of `/api/v1`, in the order the documentation lists them.
 * The route handler, the OpenAPI document, the contract tests and API.md
 * all read this one list.
 */

const RESOURCES: Endpoint[] = [
  ...integrationEndpoints,
  ...employeeEndpoints,
  ...lifecycleEndpoints,
  ...correctionEndpoints,
  ...orgEndpoints,
  ...headcountEndpoints,
  ...importEndpoints,
  ...timeEndpoints,
  ...attendanceEndpoints,
  ...payrollEndpoints,
  ...loansClaimsEndpoints,
  ...otherEndpoints,
];

const specEndpoint: Endpoint = {
  method: "GET",
  path: "/openapi.json",
  tag: "Authentication",
  summary: "This API's OpenAPI 3.1 specification",
  scopes: [],
  public: true,
  response: z.record(z.string(), z.unknown()),
  handler: async (ctx) => ({ body: buildOpenApi(ENDPOINTS, `${ctx.origin}/api/v1`) }),
};

export const ENDPOINTS: Endpoint[] = [...RESOURCES, specEndpoint];

export const dispatch = createRouter(ENDPOINTS);
