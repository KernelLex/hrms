import { SignInForm } from "./form";
import { DemoAccounts } from "./demo-accounts";
import { MoreDetails } from "@/components/inputs";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, demoSignInEnabled } from "@/lib/demo";

/**
 * §11 Sign-in: a centred 380px column — brand mark, title and subtitle, then
 * the accounts as rows.
 *
 * While this is a prototype the accounts are the way in: one click opens that
 * person's screens. The password form stays, folded away, for when one-click
 * sign-in is switched off or an account is not a demo one.
 */
export default function SignInPage() {
  const oneClick = demoSignInEnabled();

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-[13px] font-semibold text-white">
            H
          </span>
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-ink">HRMS</span>
        </div>

        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
          Sign in
        </h1>
        <p className="mt-1 text-[15px] text-muted">
          {oneClick
            ? "Choose an account to open its screens. Each role sees a different product."
            : `Sign in with a demo account. Each uses the password ${DEMO_PASSWORD}.`}
        </p>

        {oneClick ? (
          <>
            <div className="mt-7">
              <DemoAccounts accounts={DEMO_ACCOUNTS} />
            </div>
            <div className="mt-6">
              <MoreDetails label="Sign in with a password">
                <SignInForm />
              </MoreDetails>
            </div>
          </>
        ) : (
          <div className="mt-7">
            <SignInForm />
          </div>
        )}
      </div>
    </main>
  );
}
