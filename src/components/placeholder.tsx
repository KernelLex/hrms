import { Construction } from "lucide-react";
import { Card, PageHeader, EmptyState } from "@/components/ui";

/**
 * A module that has not been built yet.
 *
 * §9 Empty states say what will appear here. These are honest placeholders,
 * not fake screens — each one names the phase that fills it in.
 */
export function ModulePlaceholder({
  title,
  subtitle,
  phase,
  screens,
}: {
  title: string;
  subtitle: string;
  phase: number;
  screens: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState icon={<Construction />} title={`Arrives in phase ${phase}`}>
          {screens}
        </EmptyState>
      </Card>
    </>
  );
}
