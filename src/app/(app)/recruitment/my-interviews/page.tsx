import { CalendarClock } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listInterviews } from "@/lib/repositories/recruitment";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { InterviewTable } from "../interviews/table";

/** The interviews someone has been asked to take, and the ones they took. */
export default async function MyInterviewsPage() {
  const session = await requirePage(["recruitment.interview"], "/");
  const [upcoming, past] = session.employeeId
    ? await Promise.all([listInterviews("upcoming", session.employeeId), listInterviews("past", session.employeeId)])
    : [[], []];

  return (
    <>
      <PageHeader
        title="Interviews to take"
        subtitle="Candidates you have been asked to interview. Open a round to read about the candidate and the role, download the calendar invite, and record your notes afterwards."
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader title="Coming up" />
          {upcoming.length === 0 ? (
            <EmptyState icon={<CalendarClock />} title="Nothing scheduled">
              When recruitment asks you to interview someone, it appears here and you are told.
            </EmptyState>
          ) : (
            <InterviewTable rows={upcoming} showInterviewer={false} />
          )}
        </Card>
        {past.length > 0 ? (
          <Card>
            <CardHeader title="Done and cancelled" />
            <InterviewTable rows={past} showInterviewer={false} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
