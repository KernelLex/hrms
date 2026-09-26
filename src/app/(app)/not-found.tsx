import { FileQuestion } from "lucide-react";
import { ButtonLink, Card, EmptyState } from "@/components/ui";

/** A record or screen inside the app that does not exist, shown in the shell. */
export default function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={<FileQuestion />}
        title="That record does not exist"
        action={
          <ButtonLink href="/" variant="primary">
            Go to home
          </ButtonLink>
        }
      >
        It may have been deleted, or the link was mistyped. Search for it with Ctrl K.
      </EmptyState>
    </Card>
  );
}
