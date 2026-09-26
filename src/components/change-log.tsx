import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { describeChange } from "@/lib/change-format";
import { formatTimestamp } from "@/lib/dates";
import type { ChangeRow } from "@/lib/repositories/change-log";
import { Table, Th, Tr, Td, TwoLine } from "@/components/ui";

/** Who made a change, as the log names them. */
function actorLine(row: ChangeRow): { name: string; sub?: string } {
  if (row.actorType === "system") return { name: "System", sub: row.actorName };
  if (row.actorType === "client") return { name: row.actorName, sub: "Connected system" };
  return { name: row.actorName };
}

/** At most this many field lines per entry; the rest is summarised. */
const MAX_LINES = 6;

/**
 * The change log as a table: when, who, and what changed in words — "Basic
 * pay from 1 Apr 2025 · Amount ₹65,000 → ₹72,000". With `showSubject`, a
 * column names the employee each change was about.
 */
export function ChangeLogTable({
  rows,
  showSubject = false,
}: {
  rows: ChangeRow[];
  showSubject?: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Who</Th>
          {showSubject ? <Th>About</Th> : null}
          <Th>What changed</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const change = describeChange(row);
          const actor = actorLine(row);
          const lines = change.lines.slice(0, MAX_LINES);
          const hidden = change.lines.length - lines.length;
          return (
            <Tr key={row.id}>
              <Td>
                <span className="tabular whitespace-nowrap text-secondary">
                  {formatTimestamp(row.at)}
                </span>
              </Td>
              <Td>
                <TwoLine value={actor.name} sub={actor.sub} />
              </Td>
              {showSubject ? (
                <Td>
                  {row.subjectEmployeeId ? (
                    <Link
                      href={`/core-hr/${row.subjectEmployeeId}/changes`}
                      className="text-ink underline decoration-decor underline-offset-4 hover:decoration-ink"
                    >
                      {row.subjectName ?? `Employee ${row.subjectEmployeeId}`}
                    </Link>
                  ) : (
                    <span className="text-decor">—</span>
                  )}
                </Td>
              ) : null}
              <Td>
                <div className="min-w-[260px]">
                  <div className="font-medium text-ink">{change.title}</div>
                  {lines.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
                      {lines.map((line) => (
                        <li key={line.label} className="flex flex-wrap items-center gap-x-1.5">
                          <span>{line.label}</span>
                          {line.before !== undefined && line.after !== undefined ? (
                            <>
                              <span className="tabular text-secondary line-through decoration-decor">
                                {line.before}
                              </span>
                              <ArrowRight className="size-3.5 text-faint" aria-label="to" />
                              <span className="tabular text-ink">{line.after}</span>
                            </>
                          ) : (
                            <span className="tabular text-ink">{line.after ?? line.before}</span>
                          )}
                        </li>
                      ))}
                      {hidden > 0 ? <li>and {hidden} more</li> : null}
                    </ul>
                  ) : null}
                  {row.reason ? (
                    <p className="mt-1 text-[13px] text-muted">Reason: {row.reason}</p>
                  ) : null}
                </div>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
