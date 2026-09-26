import { redirect } from "next/navigation";
import { getAccess, canAny, roleLabel } from "@/lib/access";
import { navFor } from "@/lib/nav";
import { Shell } from "@/components/shell";
import { ToastProvider } from "@/components/toast";
import { CommandMenuProvider } from "@/components/command-menu";
import { commandsFor } from "@/lib/commands";
import { signOutAction } from "@/app/actions/auth";
import { unreadCount } from "@/lib/notifications";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAccess();
  if (!session) redirect("/sign-in");

  const { actions, pages } = commandsFor(session.permissions);
  const unread = await unreadCount(session.userId);

  return (
    <ToastProvider>
      <CommandMenuProvider
        actions={actions}
        pages={pages}
        canSearchPeople={canAny(session, "employee.view_all", "employee.view_team")}
      >
        <Shell
          groups={navFor(session.permissions)}
          name={session.displayName}
          role={roleLabel(session)}
          unread={unread}
          signOutAction={signOutAction}
        >
          {children}
        </Shell>
      </CommandMenuProvider>
    </ToastProvider>
  );
}
