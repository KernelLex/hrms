import Link from "next/link";
import { ChevronRight, Briefcase } from "lucide-react";
import { publishedRoles } from "@/lib/repositories/recruitment";
import { experienceText } from "@/lib/recruitment-values";
import { formatDate } from "@/lib/dates";
import { Card, EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Every open, published role. */
export default async function CareersPage() {
  const roles = await publishedRoles();
  return (
    <>
      <h1 className="text-[32px] leading-tight font-semibold tracking-[-0.02em] text-ink">Open roles</h1>
      <p className="mt-2 max-w-[620px] text-[15px] text-muted">
        {roles.length === 0
          ? "There are no open roles right now. Please check back soon."
          : `${roles.length} role${roles.length === 1 ? "" : "s"} open. Choose one to read about it and apply; it takes a few minutes, with your resume to hand.`}
      </p>

      <Card className="mt-8">
        {roles.length === 0 ? (
          <EmptyState icon={<Briefcase />} title="Nothing open today" />
        ) : (
          <ul className="py-2">
            {roles.map((r) => {
              const experience = experienceText(r.experienceMinYears, r.experienceMaxYears);
              return (
                <li key={r.id}>
                  <Link
                    href={`/careers/${r.code}`}
                    className="mx-2 flex items-center justify-between gap-4 rounded-xl px-4 py-4 transition-colors duration-150 hover:bg-canvas"
                  >
                    <div className="min-w-0">
                      <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{r.title}</div>
                      <div className="mt-1 text-[13px] text-muted">
                        {[r.department, r.location, r.workMode, r.employmentType, experience].filter(Boolean).join(" · ")}
                      </div>
                      <div className="mt-1 text-xs text-muted">Posted {formatDate(r.postedDate)}</div>
                    </div>
                    <ChevronRight className="size-5 shrink-0 text-decor" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
