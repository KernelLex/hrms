import { SignInForm } from "./form";
import { Card } from "@/components/ui";

/**
 * §11 Sign-in: a centred 380px column — brand mark, title and subtitle, the
 * form, then a card listing the accounts as rows.
 */
export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
            H
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
            HRMS
          </span>
        </div>

        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Sign in
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          Use one of the demo accounts below.
        </p>

        <div className="mt-7">
          <SignInForm />
        </div>

        <Card className="mt-8 overflow-hidden">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-[13px] font-medium text-ink">Demo accounts</h2>
            <p className="mt-0.5 text-xs text-muted">
              Every account uses the password <span className="text-ink">demo1234</span>.
            </p>
          </div>
          <ul className="divide-y divide-soft">
            {[
              { user: "hr.admin", role: "HR administrator" },
              { user: "ravi.kumar", role: "Manager" },
              { user: "arjun.mehta", role: "Employee" },
            ].map((a) => (
              <li
                key={a.user}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <span className="text-[13px] font-medium text-ink">{a.user}</span>
                <span className="text-[13px] text-muted">{a.role}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
