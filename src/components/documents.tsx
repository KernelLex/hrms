"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Upload } from "lucide-react";
import {
  uploadEmployeeDocument,
  removeEmployeeDocument,
} from "@/app/actions/documents";
import { EMPLOYEE_DOCUMENT_KINDS } from "@/lib/document-kinds";
import { Button, EmptyState } from "@/components/ui";
import { Field, Select, FormError } from "@/components/inputs";
import { useToast } from "@/components/toast";
import { formatTimestamp } from "@/lib/dates";

export type DocumentRow = {
  id: number;
  kind: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
};

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A person's documents: download for anyone allowed to see them, and for HR
 * the upload form and a remove button on each.
 */
export function DocumentList({
  employeeId,
  documents,
  canManage,
}: {
  employeeId: number;
  documents: DocumentRow[];
  canManage: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [kind, setKind] = React.useState<string>(EMPLOYEE_DOCUMENT_KINDS[0]);
  const [busy, setBusy] = React.useState<number | "upload" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy("upload");
    setError(null);
    const form = new FormData();
    form.set("employeeId", String(employeeId));
    form.set("kind", kind);
    form.set("file", file);
    try {
      const result = await uploadEmployeeDocument({}, form);
      if (result.error) setError(result.error);
      else {
        toast(`${kind} uploaded`);
        router.refresh();
      }
    } catch {
      setError("The upload did not finish. Check the file is under 4 MB and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (doc: DocumentRow) => {
    setBusy(doc.id);
    setError(null);
    const form = new FormData();
    form.set("documentId", String(doc.id));
    const result = await removeEmployeeDocument({}, form);
    setBusy(null);
    if (result.error) setError(result.error);
    else {
      toast(`${doc.kind} removed`);
      router.refresh();
    }
  };

  return (
    <div>
      {documents.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents on file">
          {canManage
            ? "Offer letters, identity and address proofs appear here once uploaded below."
            : "HR files your offer letter and proofs here, for you to download."}
        </EmptyState>
      ) : (
        <ul className="pb-2">
          {documents.map((d) => (
            <li
              key={d.id}
              className="mx-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl px-3 py-3 transition-colors duration-150 hover:bg-canvas"
            >
              <FileText className="size-4 shrink-0 stroke-[1.75] text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-ink">{d.kind}</div>
                <div className="truncate text-[13px] text-muted">
                  {d.fileName}, {size(d.sizeBytes)}, added {formatTimestamp(d.uploadedAt)}
                </div>
              </div>
              <a
                href={`/api/documents/${d.id}`}
                download
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-secondary transition-colors duration-150 hover:bg-soft hover:text-ink [&_svg]:size-4"
                aria-label={`Download ${d.kind}, ${d.fileName}`}
              >
                <Download />
                Download
              </a>
              {canManage ? (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => void remove(d)}
                  aria-label={`Remove ${d.kind}, ${d.fileName}`}
                >
                  {busy === d.id ? <Loader2 className="animate-spin" /> : null}
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="border-t border-soft px-6 py-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Kind of document" htmlFor="doc-kind" className="min-w-[220px] flex-1 sm:flex-none">
              <Select id="doc-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                {EMPLOYEE_DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
            </Field>
            <input
              ref={input}
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              {busy === "upload" ? <Loader2 className="animate-spin" /> : <Upload />}
              Upload document
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">PDF, Word, JPEG or PNG, up to 4 MB.</p>
          {error ? (
            <div className="mt-3">
              <FormError>{error}</FormError>
            </div>
          ) : null}
        </div>
      ) : error ? (
        <div className="px-6 pb-4">
          <FormError>{error}</FormError>
        </div>
      ) : null}
    </div>
  );
}
