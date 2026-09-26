import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { navForRoles, roleLabel } from "@/lib/nav";
import { Shell } from "@/components/shell";
import { ToastProvider } from "@/components/toast";
import { CommandMenuProvider } from "@/components/command-menu";
import { commandsFor } from "@/lib/commands";
import { signOutAction } from "@/app/actions/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const { actions, pages } = commandsFor(session.roles);

  return (
    <ToastProvider>
      <CommandMenuProvider
        actions={actions}
        pages={pages}
        canSearchPeople={session.roles.includes("HR_ADMIN") || session.roles.includes("MANAGER")}
      >
        <Shell
          groups={navForRoles(session.roles)}
          name={session.displayName}
          role={roleLabel(session.roles)}
          signOutAction={signOutAction}
        >
          {children}
        </Shell>
      </CommandMenuProvider>
    </ToastProvider>
  );
}
