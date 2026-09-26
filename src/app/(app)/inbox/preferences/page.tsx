import { requirePage } from "@/lib/access";
import { emailsFor, preferencesOf } from "@/lib/notifications";
import { Card, CardHeader, Notice, PageHeader, Tab, Tabs } from "@/components/ui";
import { PreferencesForm } from "./form";

/** Per kind of notification: in the inbox, by email, both or neither. */
export default async function NotificationPreferencesPage() {
  const session = await requirePage();

  const [prefs, emails] = await Promise.all([
    preferencesOf(session.userId),
    emailsFor([session.userId]),
  ]);
  const email = emails.get(session.userId);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="What needs your attention, and what has happened to your requests."
      />
      <Tabs>
        <Tab href="/inbox">Inbox</Tab>
        <Tab href="/inbox/preferences" active>
          Preferences
        </Tab>
      </Tabs>

      <Card>
        <CardHeader
          title="What you hear about"
          description={
            email
              ? `Emails go to ${email}.`
              : "You have no work email on file, so notifications appear in your inbox only."
          }
        />
        <PreferencesForm prefs={prefs} hasEmail={Boolean(email)} />
      </Card>
      <div className="mt-4">
        <Notice>
          Email is written to the outbox but not sent yet: sending starts once an email
          provider is connected.
        </Notice>
      </div>
    </>
  );
}
