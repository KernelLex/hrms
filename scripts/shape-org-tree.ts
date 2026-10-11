/**
 * Puts an existing database's org tree into the shape the reference design
 * describes: organisation, company, business vertical, business centre,
 * department (nesting as deep as it likes) and cost centre.
 *
 *   npm run org:shape            say what it would do, change nothing
 *   npm run org:shape -- --apply actually do it
 *
 * Written for a tenant whose tree grew before the levels above it existed —
 * business centres sitting at the top with no organisation or vertical over
 * them. It only ever adds the missing levels above what is there and moves
 * nodes under them; it never renames, deletes or re-codes anything. Running
 * it twice does nothing the second time.
 *
 * Names are placeholders. Edit ORGANISATION_NAME and the vertical name below,
 * or rename them afterwards on the Org units screen; the shape is the point.
 */
import { createClient, type Client, type InStatement } from "@libsql/client";
import { loadEnv } from "../src/db/load-env";

loadEnv();

const ORGANISATION_CODE = "ORG";
const ORGANISATION_NAME = "Organisation";
/** One vertical per company, since a vertical belongs to exactly one company. */
const verticalCode = (company: string) => `BV-${company}`;
const verticalName = (company: string) => `${company} operations`;

const OPEN_ENDED = "9999-12-31";
const FROM = "2000-01-01";

const apply = process.argv.includes("--apply");
const plan: InStatement[] = [];
const said: string[] = [];

function will(what: string, statement: InStatement) {
  said.push(what);
  plan.push(statement);
}

const rows = async (c: Client, sql: string, args: unknown[] = []) =>
  (await c.execute({ sql, args: args as never })).rows as unknown as Record<string, unknown>[];

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set.");
  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, timeout: 15_000 });
  console.log(`${apply ? "Shaping" : "Reading"} ${url}\n`);

  const levels = await rows(client, "SELECT * FROM om_level_type");
  const byRole = (role: string) => levels.filter((l) => Number(l[role]) === 1).map((l) => String(l.code));
  const topLevel = levels.find((l) => l.parent_level_type_code === null && Number(l.rank) === 0);
  const verticalLevel = levels.find((l) => String(l.parent_level_type_code ?? "") === String(topLevel?.code ?? ""));
  const centreLevels = byRole("is_payroll_group");
  const costLevels = byRole("is_cost_centre");

  if (!topLevel) throw new Error("No top level is configured. Set the levels up first.");
  if (!verticalLevel) throw new Error(`No level sits under ${topLevel.code}. Set the levels up first.`);
  console.log(`levels: organisation=${topLevel.code}, vertical=${verticalLevel.code}, centre=${centreLevels.join("/")}, cost=${costLevels.join("/")}\n`);

  const units = await rows(client, "SELECT * FROM om_org_unit");
  const unit = new Map(units.map((u) => [String(u.code), u]));
  const companies = await rows(client, "SELECT * FROM om_company ORDER BY code");

  // 1. the organisation, if it is missing
  const organisation = units.find((u) => String(u.level_type_code) === String(topLevel.code));
  const orgCode = organisation ? String(organisation.code) : ORGANISATION_CODE;
  if (!organisation) {
    will(`create ${orgCode} as the ${topLevel.name}`, {
      sql: `INSERT INTO om_org_unit (code, name, parent_code, company_code, level_type_code, valid_from, valid_to, is_active)
            VALUES (?, ?, NULL, NULL, ?, ?, ?, 1)`,
      args: [orgCode, ORGANISATION_NAME, String(topLevel.code), FROM, OPEN_ENDED],
    });
  } else {
    console.log(`  ${orgCode} is already the ${topLevel.name}`);
  }

  // 2. every company hangs off it
  for (const c of companies) {
    if (c.parent_node_code === null) {
      will(`put company ${c.code} under ${orgCode}`, {
        sql: "UPDATE om_company SET parent_node_code = ? WHERE code = ?",
        args: [orgCode, String(c.code)],
      });
    }
  }

  // 3. a vertical per company, between the organisation and its centres.
  // Only for a company that actually has centres floating at the top: this
  // repairs a tree, it does not scaffold levels nobody is using yet.
  const needsVertical = new Set(
    units
      .filter((u) => centreLevels.includes(String(u.level_type_code)) && u.parent_code === null && u.company_code !== null)
      .map((u) => String(u.company_code)),
  );
  const verticalOf = new Map<string, string>();
  for (const c of companies) {
    const company = String(c.code);
    if (!needsVertical.has(company)) continue;
    const existing = units.find((u) => String(u.level_type_code) === String(verticalLevel.code) && String(u.company_code ?? "") === company);
    const code = existing ? String(existing.code) : verticalCode(company);
    verticalOf.set(company, code);
    if (!existing) {
      will(`create ${code} as a ${verticalLevel.name} for ${company}`, {
        sql: `INSERT INTO om_org_unit (code, name, parent_code, company_code, level_type_code, valid_from, valid_to, is_active)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        args: [code, verticalName(company), orgCode, company, String(verticalLevel.code), FROM, OPEN_ENDED],
      });
    }
  }

  // 4. centres that float at the top move under their company's vertical
  for (const u of units) {
    if (!centreLevels.includes(String(u.level_type_code))) continue;
    if (u.parent_code !== null) continue;
    const company = u.company_code === null ? null : String(u.company_code);
    const vertical = company ? verticalOf.get(company) : undefined;
    if (!vertical) {
      console.log(`  ! ${u.code} belongs to no company, so there is no vertical to put it under — left alone`);
      continue;
    }
    will(`move ${u.code} under ${vertical}`, {
      sql: "UPDATE om_org_unit SET parent_code = ? WHERE code = ?",
      args: [vertical, String(u.code)],
    });
  }

  // 5. the cost centres people are already booked to, as real nodes
  if (costLevels.length > 0) {
    const costLevel = levels.find((l) => String(l.code) === costLevels[0])!;
    const allowedParent = [String(costLevel.parent_level_type_code ?? ""), String(costLevel.code)];
    const booked = await rows(
      client,
      `SELECT o.cost_center AS code, o.org_unit_code AS unit, o.company_code AS company, COUNT(*) AS n
       FROM pa_it0001_org_assignment o WHERE o.cost_center IS NOT NULL AND o.cost_center <> ''
       GROUP BY o.cost_center, o.org_unit_code, o.company_code`,
    );

    const ancestry = (code: string): string[] => {
      const out: string[] = [];
      let at: string | null = code;
      const seen = new Set<string>();
      while (at && !seen.has(at) && unit.has(at)) {
        seen.add(at);
        out.push(at);
        const above: unknown = unit.get(at)!.parent_code;
        at = above === null || above === undefined ? null : String(above);
      }
      return out;
    };

    // One cost centre, one parent — so where several departments book to the
    // same code, it goes above all of them rather than being created twice.
    const byCode = new Map<string, { unit: string; n: number; company: string | null }[]>();
    for (const b of booked) {
      const code = String(b.code);
      byCode.set(code, [...(byCode.get(code) ?? []), { unit: String(b.unit), n: Number(b.n), company: b.company === null ? null : String(b.company) }]);
    }

    for (const [code, places] of byCode) {
      if (unit.has(code)) continue;
      const known = places.filter((p) => unit.has(p.unit));
      if (known.length === 0) {
        console.log(`  ! cost centre ${code} is booked against units that do not exist — left alone`);
        continue;
      }
      const busiest = [...known].sort((a, b) => b.n - a.n)[0];
      let parent = busiest.unit;
      if (known.length > 1) {
        const chains = known.map((k) => ancestry(k.unit));
        const shared = chains[0].find((candidate) => chains.every((chain) => chain.includes(candidate)));
        if (shared) parent = shared;
      }
      // Only where the levels allow it; otherwise the busiest department wins.
      if (!allowedParent.includes(String(unit.get(parent)!.level_type_code))) parent = busiest.unit;
      will(
        known.length > 1
          ? `create cost centre ${code} under ${parent} (booked from ${known.map((k) => k.unit).join(", ")})`
          : `create cost centre ${code} under ${parent}`,
        {
          sql: `INSERT INTO om_org_unit (code, name, parent_code, company_code, level_type_code, valid_from, valid_to, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
          args: [code, code, parent, busiest.company, String(costLevel.code), FROM, OPEN_ENDED],
        },
      );
    }
  }

  // 6. a business centre says whether it earns or recovers
  const businessCentreLevels = byRole("is_business_centre");
  for (const u of units) {
    if (!businessCentreLevels.includes(String(u.level_type_code))) continue;
    if (u.centre_type !== null) continue;
    will(`classify ${u.code} as a profit centre (review this on the Org units screen)`, {
      sql: "UPDATE om_org_unit SET centre_type = 'PROFIT' WHERE code = ?",
      args: [String(u.code)],
    });
  }

  console.log(said.length === 0 ? "\nnothing to do: the tree is already in shape" : `\n${said.length} changes:`);
  for (const w of said) console.log(`  - ${w}`);

  if (!apply) {
    console.log("\nnothing written. Run again with --apply to make these changes.");
    client.close();
    return;
  }
  if (plan.length > 0) {
    await client.batch(plan, "write");
    console.log("\napplied.");
  }

  const after = await rows(
    client,
    `SELECT u.code, u.name, u.level_type_code, u.parent_code, u.centre_type, t.rank
     FROM om_org_unit u JOIN om_level_type t ON t.code = u.level_type_code
     ORDER BY t.rank, u.code`,
  );
  console.log("\nthe tree now:");
  const children = new Map<string | null, typeof after>();
  for (const n of after) {
    const key = n.parent_code === null ? null : String(n.parent_code);
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  const draw = (parent: string | null, depth: number) => {
    for (const n of children.get(parent) ?? []) {
      console.log(`${"  ".repeat(depth + 1)}${String(n.code).padEnd(12)} ${String(n.level_type_code).padEnd(12)} ${n.centre_type ?? ""}`);
      draw(String(n.code), depth + 1);
    }
  };
  draw(null, 0);
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
