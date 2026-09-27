import { createServer } from "node:http";
import { ApiSession, MockErp } from "./erp";
import { runScenario } from "./scenario";

/**
 * Runs the mock ERP against a running HRMS: `npm run sandbox`.
 *
 *   HRMS_URL                 the app, default http://localhost:3000
 *   SANDBOX_CLIENT_SECRET    the secret the database was seeded with
 *   WEBHOOK_PORT             where webhooks are received, default 4010
 *
 * The database must have been seeded with SANDBOX_CLIENT_SECRET set, which
 * creates the mock ERP's client (cl_mock_erp) and a second system allowed to
 * hire (cl_sandbox_hr). Exits non-zero if any step fails.
 */

const base = (process.env.HRMS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.SANDBOX_CLIENT_SECRET;
const port = Number(process.env.WEBHOOK_PORT ?? 4010);

if (!secret) {
  console.error("Set SANDBOX_CLIENT_SECRET to the value the database was seeded with.");
  process.exit(2);
}

const api = `${base}/api/v1`;
const erp = new MockErp(new ApiSession({ baseUrl: api, clientId: "cl_mock_erp", secret }));
const hr = new ApiSession({ baseUrl: api, clientId: "cl_sandbox_hr", secret: `${secret}-hr` });
const badSession = new ApiSession({ baseUrl: api, clientId: "cl_mock_erp", secret: "not-the-secret" });

const server = createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/webhooks") {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(" ") : v]));
    const status = erp.receive({ headers, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(status).end();
  });
});

async function main() {
  await new Promise<void>((resolve) => server.listen(port, resolve));
  console.log(`Mock ERP: receiving webhooks on http://localhost:${port}/webhooks, calling ${api}\n`);

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const steps = await runScenario({
    erp,
    hr,
    badSession,
    webhookUrl: `http://localhost:${port}/webhooks`,
    today,
    // The app runs its own background work after each call; nothing to do here.
    pump: async () => {},
    log: (s) => console.log(`${s.ok ? "  ok  " : "  FAIL"}  ${s.name}\n        ${s.detail}`),
  });

  server.close();
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n${steps.length - failed} of ${steps.length} steps passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  server.close();
  process.exit(1);
});
