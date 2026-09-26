/**
 * Prints a valid session cookie value for local verification.
 *
 *   npx tsx scripts/dev-session.ts [role]
 *
 * Lets a script fetch authenticated pages without driving the sign-in form,
 * which is a Server Action and cannot be posted to directly. Signs with the
 * local AUTH_SECRET, so it is useless against any deployment.
 */
import { SignJWT } from "jose";
import { loadEnv } from "../src/db/load-env";

loadEnv();

const ROLES: Record<string, { roles: string[]; name: string; username: string }> = {
  hr: { roles: ["HR_ADMIN"], name: "Priya Sharma", username: "hr.admin" },
  manager: { roles: ["MANAGER", "EMPLOYEE"], name: "Ravi Kumar", username: "ravi.kumar" },
  employee: { roles: ["EMPLOYEE"], name: "Arjun Mehta", username: "arjun.mehta" },
};

async function main() {
  const which = process.argv[2] ?? "hr";
  const profile = ROLES[which];
  if (!profile) {
    throw new Error(`Unknown role "${which}". Use one of: ${Object.keys(ROLES).join(", ")}`);
  }

  const secret = new TextEncoder().encode(process.env.AUTH_SECRET!);
  const token = await new SignJWT({
    userId: 1,
    username: profile.username,
    displayName: profile.name,
    roles: profile.roles,
    employeeId: null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(secret);

  process.stdout.write(token);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
