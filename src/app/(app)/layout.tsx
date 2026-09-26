import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { navForRoles, roleLabel } from "@/lib/nav";
import { Shell } from "@/components/shell";
import { signOutAction } from "@/app/actions/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <Shell
      groups={navForRoles(session.roles)}
      name={session.displayName}
      role={roleLabel(session.roles)}
      signOutAction={signOutAction}
    >
      {children}
    </Shell>
  );
}
