import { requirePage } from "@/lib/access";
import { letterTemplates } from "@/lib/repositories/lifecycle";
import { PageHeader, Card, CardHeader, CardBody, EmptyState } from "@/components/ui";
import { FileText } from "lucide-react";
import { EditTemplateButton, NewTemplateButton } from "./template-form";

export default async function LetterTemplatesPage() {
  await requirePage(["employee.edit"]);
  const templates = await letterTemplates();

  return (
    <>
      <PageHeader title="Letter templates" subtitle="What HR can issue from the Career tab. Saving makes a new version; letters already issued keep their exact wording." actions={<NewTemplateButton />} />
      {templates.length === 0 ? (
        <Card>
          <EmptyState icon={<FileText />} title="No letter templates">Add one to start issuing letters.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader title={t.kind} description={`Version ${t.version}`} actions={<EditTemplateButton kind={t.kind} body={t.body} />} />
              <CardBody>
                <p className="whitespace-pre-line text-[13px] text-ink-hover">{t.body}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
