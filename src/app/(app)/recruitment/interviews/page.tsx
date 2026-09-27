import { CalendarClock } from "lucide-react";
import { requirePage } from "@/lib/access";
import { listInterviews } from "@/lib/repositories/recruitment";
import { Card, EmptyState, PageHeader, Tab, Tabs } from "@/components/ui";
import { RecruitmentTabs } from "../tabs";
import { InterviewTable } from "./table";

/**
 * RC-04 — every interview round, upcoming and past. Rounds are scheduled on
 * the application they belong to; this is where to see them all at once.
 */
export default async function InterviewsPage(props: { searchParams: Promise<{ when?: string }> }) {
  await requirePage(["recruitment.manage"], "/");
  const when = (await props.searchParams).when === "past" ? "past" : "upcoming";
  const rows = await listInterviews(when);

  return (
    <>
      <RecruitmentTabs />
      <PageHeader title="Interviews" subtitle="Every round across all applications. Schedule rounds from the application they belong to." />
      <Tabs>
        <Tab href="/recruitment/interviews" active={when === "upcoming"}>
          Upcoming
        </Tab>
        <Tab href="/recruitment/interviews?when=past" active={when === "past"}>
          Done and cancelled
        </Tab>
      </Tabs>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<CalendarClock />} title={when === "upcoming" ? "Nothing scheduled" : "No past rounds"}>
            {when === "upcoming" ? "Open an application that is being interviewed to schedule its next round." : "Rounds move here once their notes are recorded, or they are cancelled."}
          </EmptyState>
        ) : (
          <InterviewTable rows={rows} showInterviewer />
        )}
      </Card>
    </>
  );
}
