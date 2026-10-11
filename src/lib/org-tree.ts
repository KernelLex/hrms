import "server-only";
import { rawClient } from "@/lib/db";

/**
 * The org hierarchy as one walkable tree.
 *
 * The shape of the hierarchy is configuration (`om_level_type`), so nothing
 * here resolves anything by level *name*. A behaviour — where payroll groups,
 * where a holiday calendar attaches, what the ERP reads as a cost centre —
 * belongs to whichever level HR flagged for it, and is found by walking up
 * from a node until a level carrying that flag turns up.
 *
 * Loaded once and walked in memory rather than queried per employee: the same
 * batch-then-apply shape `payroll.ts` and `quota.ts` already use, because the
 * callers that matter (a payroll run, a year-end accrual) resolve this for
 * every employee in the company at once.
 */

export type NodeRole = "isPayrollGroup" | "isCalendarLevel" | "isCostCentre";

export type OrgNode = {
  code: string;
  name: string;
  parentCode: string | null;
  companyCode: string | null;
  calendarCode: string | null;
  levelTypeCode: string;
  levelTypeName: string;
  isPayrollGroup: boolean;
  isCalendarLevel: boolean;
  isCostCentre: boolean;
  isActive: boolean;
};

export type OrgTree = Map<string, OrgNode>;

/** Every node with its level's role flags, in one query. */
export async function loadOrgTree(): Promise<OrgTree> {
  const r = await rawClient().execute(
    `SELECT u.code, u.name, u.parent_code, u.company_code, u.calendar_code, u.level_type_code,
            u.is_active, t.name AS level_type_name,
            t.is_payroll_group, t.is_calendar_level, t.is_cost_centre
     FROM om_org_unit u
     LEFT JOIN om_level_type t ON t.code = u.level_type_code`,
  );
  const tree: OrgTree = new Map();
  for (const row of r.rows) {
    tree.set(String(row.code), {
      code: String(row.code),
      name: String(row.name),
      parentCode: row.parent_code === null ? null : String(row.parent_code),
      companyCode: row.company_code === null ? null : String(row.company_code),
      calendarCode: row.calendar_code === null ? null : String(row.calendar_code),
      levelTypeCode: String(row.level_type_code),
      levelTypeName: row.level_type_name === null ? String(row.level_type_code) : String(row.level_type_name),
      isPayrollGroup: Number(row.is_payroll_group) === 1,
      isCalendarLevel: Number(row.is_calendar_level) === 1,
      isCostCentre: Number(row.is_cost_centre) === 1,
      isActive: Number(row.is_active) === 1,
    });
  }
  return tree;
}

/**
 * The node itself, then each parent up to the root. Stops on a cycle rather
 * than looping forever: the save paths reject cycles, but a tree read at
 * runtime should not hang if one ever slipped in.
 */
export function ancestryOf(tree: OrgTree, code: string | null): OrgNode[] {
  const out: OrgNode[] = [];
  const seen = new Set<string>();
  let at = code;
  while (at !== null && !seen.has(at)) {
    seen.add(at);
    const node = tree.get(at);
    if (!node) break;
    out.push(node);
    at = node.parentCode;
  }
  return out;
}

/**
 * The nearest node at or above `code` whose level carries `role` — what
 * "which payroll group is this employee in" and "whose holiday calendar do
 * they follow" both resolve through.
 */
export function nearestAncestorWithRole(tree: OrgTree, code: string | null, role: NodeRole): OrgNode | null {
  for (const node of ancestryOf(tree, code)) if (node[role]) return node;
  return null;
}

/** A node and everything beneath it, for "this subtree" membership and scope. */
export function subtreeOf(tree: OrgTree, code: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const node of tree.values()) {
    if (node.parentCode === null) continue;
    const list = children.get(node.parentCode);
    if (list) list.push(node.code);
    else children.set(node.parentCode, [node.code]);
  }
  const out = new Set<string>();
  const stack = [code];
  while (stack.length > 0) {
    const at = stack.pop()!;
    if (out.has(at)) continue;
    out.add(at);
    for (const child of children.get(at) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Every org unit whose nearest payroll-group ancestor is `nodeCode` — the
 * membership of one payroll period, as a set to match org units against.
 *
 * Not simply the subtree: a node deeper down may carry the payroll-group flag
 * itself, and everything under *it* belongs to that period instead.
 */
export function payrollGroupMembers(tree: OrgTree, nodeCode: string): Set<string> {
  const out = new Set<string>();
  for (const node of tree.values()) {
    const group = nearestAncestorWithRole(tree, node.code, "isPayrollGroup");
    if (group?.code === nodeCode) out.add(node.code);
  }
  return out;
}

/** The level types HR has flagged as cost-booking leaves. */
export async function costCentreLevelTypes(): Promise<Set<string>> {
  const r = await rawClient().execute("SELECT code FROM om_level_type WHERE is_cost_centre = 1");
  return new Set(r.rows.map((row) => String(row.code)));
}
