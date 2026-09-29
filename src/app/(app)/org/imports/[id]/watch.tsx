"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { watchImport } from "@/app/actions/imports";
import { Notice } from "@/components/ui";

/** Polls a running import until it finishes, then reloads the page to show the final counts. */
export function ImportProgressWatcher({ id }: { id: number }) {
  const router = useRouter();
  const [done, setDone] = React.useState(0);
  const [total, setTotal] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      for (;;) {
        const p = await watchImport(id);
        if (cancelled) return;
        if ("error" in p) return;
        setDone(p.writtenRows + p.skippedRows + p.errorRows);
        setTotal(p.totalRows);
        if (p.completed) {
          router.refresh();
          return;
        }
        await new Promise((r) => setTimeout(r, 1200));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  return (
    <div className="mb-6">
      <Notice icon={<Loader2 className="animate-spin" />}>
        Writing the rows that passed{total ? ` — ${done} of ${total}` : ""}. This page updates itself.
      </Notice>
    </div>
  );
}
