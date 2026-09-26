import { requirePage } from "@/lib/access";
import { Bell, CheckCheck } from "lucide-react";
import { listNotifications } from "@/lib/notifications";
import { formatTimestamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { openNotification, markAllRead } from "@/app/actions/notifications";
import { Button, Card, EmptyState, PageHeader, Tab, Tabs } from "@/components/ui";
import { Pagination, pageFrom } from "@/components/pagination";

/**
 * What the system has told you: leave decisions, payslips, reviews due.
 * Opening one marks it read and takes you to the thing it is about.
 */
export default async function InboxPage(props: { searchParams: Promise<{ page?: string }> }) {
  const session = await requirePage();

  const { page, limit, offset } = pageFrom((await props.searchParams).page);
  const { rows, total } = await listNotifications(session.userId, limit, offset);
  const unread = rows.some((n) => !n.readAt);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="What needs your attention, and what has happened to your requests."
        actions={
          unread ? (
            <form action={markAllRead}>
              <Button type="submit">
                <CheckCheck />
                Mark all as read
              </Button>
            </form>
          ) : undefined
        }
      />
      <Tabs>
        <Tab href="/inbox" active>
          Inbox
        </Tab>
        <Tab href="/inbox/preferences">Preferences</Tab>
      </Tabs>

      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={<Bell />} title="Nothing here yet">
            When a request is decided, a payslip is ready or a review is due, you hear about it
            here.
          </EmptyState>
        ) : (
          <>
            <ul className="py-2">
              {rows.map((n) => (
                <li key={n.id}>
                  <form action={openNotification}>
                    <input type="hidden" name="id" value={n.id} />
                    <button
                      type="submit"
                      className="mx-3 flex w-[calc(100%-1.5rem)] items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-150 hover:bg-canvas"
                    >
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          n.readAt ? "bg-transparent" : "bg-ink",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm text-ink",
                            n.readAt ? "font-normal" : "font-medium",
                          )}
                        >
                          {n.title}
                          {n.readAt ? null : <span className="sr-only"> (unread)</span>}
                        </span>
                        {n.body ? (
                          <span className="mt-0.5 block text-[13px] text-muted">{n.body}</span>
                        ) : null}
                      </span>
                      <span className="tabular shrink-0 text-xs text-muted">
                        {formatTimestamp(n.createdAt)}
                      </span>
                    </button>
                  </form>
                </li>
              ))}
            </ul>
            <Pagination page={page} total={total} path="/inbox" noun="notifications" />
          </>
        )}
      </Card>
    </>
  );
}
