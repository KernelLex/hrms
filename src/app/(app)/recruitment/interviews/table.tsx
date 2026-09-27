import Link from "next/link";
import type { InterviewRow } from "@/lib/repositories/recruitment";
import { INTERVIEW_LABEL, INTERVIEW_TONE, RECOMMENDATION_LABEL } from "@/lib/recruitment-values";
import { formatDate, formatTime } from "@/lib/dates";
import { Status, Table, Th, Tr, Td, TwoLine } from "@/components/ui";

/** Interview rounds as a table, each opening the round's own page. */
export function InterviewTable({ rows, showInterviewer }: { rows: InterviewRow[]; showInterviewer: boolean }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>When</Th>
          <Th>Candidate</Th>
          <Th>Round</Th>
          {showInterviewer ? <Th>Interviewer</Th> : null}
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => (
          <Tr key={i.id}>
            <Td>
              <TwoLine
                value={<span className="tabular">{formatDate(i.scheduledDate)}</span>}
                sub={`${i.scheduledTime ? formatTime(i.scheduledTime) : "No time set"}, ${i.durationMinutes} min, ${i.mode.toLowerCase()}`}
              />
            </Td>
            <Td>
              <Link href={`/recruitment/interviews/${i.id}`} className="hover:underline">
                <TwoLine value={i.candidateName} sub={`${i.roleTitle}, ${i.requisitionCode}`} />
              </Link>
            </Td>
            <Td>
              <span className="text-secondary">{i.round}</span>
            </Td>
            {showInterviewer ? (
              <Td>
                <span className="text-secondary">{i.interviewer}</span>
              </Td>
            ) : null}
            <Td>
              <TwoLine
                value={<Status tone={INTERVIEW_TONE[i.status] ?? "neutral"}>{INTERVIEW_LABEL[i.status] ?? i.status}</Status>}
                sub={
                  i.status === "Completed"
                    ? `${i.rating ? `${i.rating} of 5` : "Not rated"}${i.recommendation ? `, ${RECOMMENDATION_LABEL[i.recommendation]?.toLowerCase()}` : ""}`
                    : undefined
                }
              />
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
