import "server-only";
import { rawClient } from "@/lib/db";

/**
 * Performance's shared reads: the 360 feedback a reviewee may see, kept
 * behind its own anonymity threshold.
 */

export type FeedbackLine = { relationship: string; competency: string; rating: number | null; comments: string | null };

export type PeerFeedbackSummary = {
  /** Null until three peers have answered — individual peer comments are never shown. */
  peerAverageByCompetency: Record<string, number> | null;
  peerResponseCount: number;
  /** Manager, report and self feedback: shown individually, no threshold. */
  individual: FeedbackLine[];
};

const ANONYMITY_THRESHOLD = 3;

/** Everything a reviewee (or whoever runs performance) may read about one cycle's 360 feedback. */
export async function peerFeedbackSummary(revieweeEmployeeId: number, cycleId: number): Promise<PeerFeedbackSummary> {
  const rows = (
    await rawClient().execute({
      sql: `SELECT r.relationship, f.competency, f.rating, f.comments
            FROM pm_feedback_request r JOIN pm_feedback f ON f.request_id = r.id
            WHERE r.reviewee_employee_id = ? AND r.cycle_id = ? AND r.status = 'Submitted'`,
      args: [revieweeEmployeeId, cycleId],
    })
  ).rows.map((r) => ({ relationship: String(r.relationship), competency: String(r.competency), rating: r.rating === null ? null : Number(r.rating), comments: r.comments === null ? null : String(r.comments) }));

  const peerRequestCount = Number(
    (
      await rawClient().execute({
        sql: "SELECT COUNT(*) AS n FROM pm_feedback_request WHERE reviewee_employee_id = ? AND cycle_id = ? AND relationship = 'Peer' AND status = 'Submitted'",
        args: [revieweeEmployeeId, cycleId],
      })
    ).rows[0].n,
  );

  let peerAverageByCompetency: Record<string, number> | null = null;
  if (peerRequestCount >= ANONYMITY_THRESHOLD) {
    const peerRows = rows.filter((r) => r.relationship === "Peer" && r.rating !== null);
    const byCompetency = new Map<string, number[]>();
    for (const r of peerRows) byCompetency.set(r.competency, [...(byCompetency.get(r.competency) ?? []), r.rating!]);
    peerAverageByCompetency = Object.fromEntries(
      [...byCompetency.entries()].map(([c, ratings]) => [c, Math.round((ratings.reduce((s, v) => s + v, 0) / ratings.length) * 10) / 10]),
    );
  }

  return {
    peerAverageByCompetency,
    peerResponseCount: peerRequestCount,
    individual: rows.filter((r) => r.relationship !== "Peer"),
  };
}
