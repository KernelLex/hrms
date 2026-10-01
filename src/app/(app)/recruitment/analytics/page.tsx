import { requirePage } from "@/lib/access";
import { recruitmentAnalytics } from "@/lib/repositories/recruitment";
import { OFFER_LABEL, STAGE_LABEL } from "@/lib/recruitment-values";
import { Card, CardHeader, Figure, FigureRow, PageHeader } from "@/components/ui";
import { BarList } from "@/components/charts";
import { RecruitmentTabs } from "../tabs";

const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** How hiring is going, not just where it stands: time to hire, time in stage, sources, offers, drop-off. */
export default async function RecruitmentAnalyticsPage() {
  await requirePage(["recruitment.manage"], "/");
  const a = await recruitmentAnalytics();

  const sourceBars = a.sourceEffectiveness.map((s) => ({ label: s.source, value: s.applications }));
  const hireBars = a.sourceEffectiveness.map((s) => ({ label: s.source, value: s.hires }));
  const dropOff = a.dropOffByStage.map((b) => ({ ...b, label: (STAGE_LABEL as Record<string, string>)[b.label] ?? b.label }));
  const offers = a.offersByStatus.map((b) => ({ ...b, label: OFFER_LABEL[b.label] ?? b.label }));

  return (
    <>
      <RecruitmentTabs />
      <PageHeader title="Recruitment analytics" subtitle="How hiring is going, over every requisition on record." />

      <FigureRow>
        <Figure label="Time to hire" value={a.timeToHireDays === null ? "—" : days(a.timeToHireDays)} hint="applied to hired, on average" />
      </FigureRow>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Time in each stage" description="Average days before moving on." />
          <BarList items={a.timeInStage} format={days} empty="Not enough history yet." />
        </Card>

        <Card>
          <CardHeader title="Offer acceptance" description="Every offer sent, by how it was answered." />
          <BarList items={offers} empty="No offers sent yet." />
        </Card>

        <Card>
          <CardHeader title="Applications by source" description="Where candidates come from." />
          <BarList items={sourceBars} empty="No applications yet." />
        </Card>

        <Card>
          <CardHeader title="Hires by source" description="Which sources turn into hires." />
          <BarList items={hireBars} empty="Nobody hired yet." />
        </Card>

        <Card>
          <CardHeader title="Drop-off by stage" description="Where candidates are not taken forward." />
          <BarList items={dropOff} empty="Nothing closed without a hire yet." />
        </Card>
      </div>
    </>
  );
}
