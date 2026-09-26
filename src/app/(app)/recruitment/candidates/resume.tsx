"use client";

import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { uploadResume, removeResume, type ActionState } from "@/app/actions/recruitment";
import { Button } from "@/components/ui";
import { useToast } from "@/components/toast";

type Doc = { id: number; fileName: string; sizeBytes: number };

function size(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * RC-02's resume: download it, replace it, or upload the first one. The file
 * picker opens straight away and the upload starts on choosing, so there is
 * no second "Upload" step to forget.
 */
export function ResumeCell({
  candidateId,
  candidateName,
  doc,
  link,
}: {
  candidateId: number;
  candidateName: string;
  doc: Doc | null;
  /** An older resume given as a web link, shown when there is no file. */
  link: string | null;
}) {
  const toast = useToast();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState<"upload" | "remove" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (kind: "upload" | "remove", action: () => Promise<ActionState>, done: string) => {
    setBusy(kind);
    setError(null);
    try {
      const result = await action();
      if (result.error) setError(result.error);
      else toast(done);
    } catch {
      setError("The upload did not finish. Check the file is under 4 MB and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const form = new FormData();
    form.set("candidateId", String(candidateId));
    form.set("file", file);
    void run("upload", () => uploadResume({}, form), doc ? "Resume replaced" : "Resume uploaded");
  };

  return (
    <div className="flex min-w-[180px] flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {doc ? (
        <div className="flex items-center gap-1">
          <a
            href={`/api/documents/${doc.id}`}
            download
            className="max-w-[160px] truncate text-[13px] font-medium text-ink hover:underline"
            title={doc.fileName}
          >
            {doc.fileName}
          </a>
          <span className="tabular text-xs text-muted">{size(doc.sizeBytes)}</span>
        </div>
      ) : link ? (
        <a
          href={link}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[13px] font-medium text-ink hover:underline"
        >
          Open link
        </a>
      ) : null}
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null}
          onClick={() => input.current?.click()}
          aria-label={`${doc ? "Replace" : "Upload"} resume for ${candidateName}`}
          className="-ml-3"
        >
          {busy === "upload" ? <Loader2 className="animate-spin" /> : <Upload />}
          {doc ? "Replace" : "Upload"}
        </Button>
        {doc ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            aria-label={`Remove resume for ${candidateName}`}
            onClick={() => {
              const form = new FormData();
              form.set("documentId", String(doc.id));
              void run("remove", () => removeResume({}, form), "Resume removed");
            }}
          >
            {busy === "remove" ? <Loader2 className="animate-spin" /> : null}
            Remove
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
