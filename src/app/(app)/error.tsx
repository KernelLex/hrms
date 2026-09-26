"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button, ButtonLink, Card, PageHeader } from "@/components/ui";

/**
 * When a screen fails to load, say so in words and offer the next step (§8.12:
 * errors say what went wrong and what to do next). The shell stays, so the
 * rest of the product is still one click away.
 *
 * In production the message from a Server Component is withheld by Next.js,
 * so the reference is what connects this screen to the server log.
 */
export default function ScreenError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  const [retrying, startRetry] = React.useTransition();

  return (
    <div data-error-boundary>
      <PageHeader
        title="This screen could not be loaded"
        subtitle="Nothing you entered has been lost. It is usually a dropped connection to the database, and trying again fixes it."
      />
      <Card className="px-6 py-5">
        <p className="text-sm text-danger-strong">
          {process.env.NODE_ENV === "development"
            ? error.message
            : "The server could not finish building this screen."}
        </p>
        {error.digest ? (
          <p className="mt-1 text-[13px] text-muted">
            Reference <span className="tabular text-ink">{error.digest}</span>, for whoever
            looks at the server log.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink href="/" variant="secondary">
            Go to home
          </ButtonLink>
          <Button
            variant="primary"
            disabled={retrying}
            onClick={() => startRetry(() => retry())}
          >
            <RotateCcw />
            Try again
          </Button>
        </div>
      </Card>
    </div>
  );
}
