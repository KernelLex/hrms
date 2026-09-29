"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, UploadCloud } from "lucide-react";
import { uploadImport, type ActionState } from "@/app/actions/imports";
import type { ImportKind, columnsFor } from "@/lib/services/imports";
import { Button, ButtonAnchor, Card, CardBody, CardHeader, Badge } from "@/components/ui";
import { Field, FormError } from "@/components/inputs";
import { TableScroll } from "@/components/table-scroll";

const INITIAL: ActionState = {};

type Kind = { kind: ImportKind; label: string; description: string; columns: ReturnType<typeof columnsFor> };

export function ImportWizard({ kinds }: { kinds: Kind[] }) {
  const router = useRouter();
  const [kind, setKind] = React.useState<ImportKind>(kinds[0].kind);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const current = kinds.find((k) => k.kind === kind)!;

  const [state, action, pending] = useActionState(async (prev: ActionState, form: FormData): Promise<ActionState> => {
    const r = await uploadImport(prev, form);
    if (r.ok && r.importId) router.push(`/org/imports/${r.importId}`);
    return r;
  }, INITIAL);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader title="1. What are you loading?" />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-3">
            {kinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setKind(k.kind)}
                className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors duration-150 ${
                  kind === k.kind ? "border-ink bg-canvas" : "border-control hover:bg-canvas"
                }`}
              >
                <span className="text-sm font-medium text-ink">{k.label}</span>
                <span className="text-xs text-muted">{k.description}</span>
              </button>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Fill in the template" description="Every column marked required has to have a value. Leave the rest blank if you have nothing to say." />
        <CardBody>
          <div className="mb-4 overflow-hidden rounded-xl border border-line">
            <TableScroll>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[13px] text-muted">
                    <th className="px-4 py-2 font-normal">Column</th>
                    <th className="px-4 py-2 font-normal">Example</th>
                    <th className="px-4 py-2 font-normal">
                      <span className="sr-only">Required</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {current.columns.map((c) => (
                    <tr key={c.name} className="border-b border-soft last:border-0">
                      <td className="px-4 py-2 font-medium text-ink">{c.name}</td>
                      <td className="px-4 py-2 text-muted">{c.hint}</td>
                      <td className="px-4 py-2">{c.required ? <Badge tone="action">Required</Badge> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
          <ButtonAnchor href={`/api/imports/template?kind=${kind}`} variant="secondary">
            <Download /> Download the {current.label.toLowerCase()} template
          </ButtonAnchor>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3. Upload it" />
        <CardBody>
          <form action={action} className="flex flex-col gap-4">
            <input type="hidden" name="kind" value={kind} />
            <Field label="File" htmlFor="file" required hint="A CSV file, up to 10 MB.">
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                className="block w-full text-sm text-secondary file:mr-4 file:rounded-lg file:border-0 file:bg-canvas file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink hover:file:bg-line"
              />
            </Field>
            {state.error ? <FormError>{state.error}</FormError> : null}
            <div className="flex justify-end">
              <Button type="submit" variant="primary" disabled={pending || !fileName}>
                {pending ? <Loader2 className="animate-spin" /> : <UploadCloud />}
                Check the file
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
