import Link from "next/link";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { publishedRole } from "@/lib/repositories/recruitment";
import { experienceText } from "@/lib/recruitment-values";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader } from "@/components/ui";
import { Lines, Paragraphs } from "@/components/prose";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const role = await publishedRole((await props.params).code);
  return { title: role ? `${role.title} — Careers` : "Careers", description: role?.description?.slice(0, 160) ?? undefined };
}

/** One open role, and the form to apply for it. */
export default async function RolePage(props: { params: Promise<{ code: string }> }) {
  const role = await publishedRole((await props.params).code);

  if (!role) {
    return (
      <div className="max-w-[560px]">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">This role is not open</h1>
        <p className="mt-2 text-[15px] text-muted">It may have been filled, or taken off this page.</p>
        <Link href="/careers" className="mt-6 inline-flex items-center gap-1 text-[15px] font-medium text-ink hover:underline">
          See the roles that are open
        </Link>
      </div>
    );
  }

  const experience = experienceText(role.experienceMinYears, role.experienceMaxYears);
  const facts = [
    ["Team", role.department],
    ["Location", role.location],
    ["Works", role.workMode],
    ["Type", role.employmentType],
    ["Experience", experience],
    ["Openings", role.openings > 1 ? String(role.openings) : null],
  ].filter((f): f is [string, string] => Boolean(f[1]));

  return (
    <>
      <Link href="/careers" className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted transition-colors duration-150 hover:text-ink">
        <ChevronLeft className="size-4" />
        All roles
      </Link>
      <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] text-ink">{role.title}</h1>
      <p className="mt-1 text-[13px] text-muted">
        {role.company ? `${role.company} · ` : ""}Posted {formatDate(role.postedDate)}
      </p>

      <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-[15px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_400px]">
        <article className="min-w-0 text-[15px] leading-relaxed text-ink-hover">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">About the role</h2>
          <Paragraphs text={role.description} />
          {role.qualifications ? (
            <>
              <h2 className="mt-8 mb-3 text-[17px] font-semibold text-ink">Qualifications</h2>
              <Lines text={role.qualifications} />
            </>
          ) : null}
          {role.skills ? (
            <>
              <h2 className="mt-8 mb-3 text-[17px] font-semibold text-ink">Skills</h2>
              <Lines text={role.skills} />
            </>
          ) : null}
        </article>

        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader title="Apply" description="Fields marked * are needed. We will write to you at the email you give." />
            <div className="px-6 pb-6">
              <ApplyForm code={role.code} title={role.title} />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
