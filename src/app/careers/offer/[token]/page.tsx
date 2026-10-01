import type { Metadata } from "next";
import { getOfferByToken } from "@/lib/repositories/recruitment";
import { formatDate } from "@/lib/dates";
import { Card, CardHeader } from "@/components/ui";
import { Paragraphs } from "@/components/prose";
import { RespondForm } from "./respond-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your offer — Careers" };

/** The candidate's own view of their offer, reached only through their link. */
export default async function OfferPage(props: { params: Promise<{ token: string }> }) {
  const offer = await getOfferByToken((await props.params).token);

  if (!offer) {
    return (
      <div className="max-w-[560px]">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">That link is not valid</h1>
        <p className="mt-2 text-[15px] text-muted">Check the link in your email, or contact recruitment.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[640px]">
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">
        Your offer: {offer.roleTitle}
      </h1>
      <p className="mt-1 text-[13px] text-muted">
        Proposed start {formatDate(offer.joiningDate)}. Open until {formatDate(offer.expiryDate)}.
      </p>

      <Card className="mt-6">
        <CardHeader title="The letter" />
        <div className="px-6 pb-6 text-[15px] leading-relaxed text-ink-hover">
          <Paragraphs text={offer.letterText} />
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Your reply" description="This records your decision with the time it was made." />
        <div className="px-6 pb-6">
          <RespondForm token={(await props.params).token} status={offer.status} />
        </div>
      </Card>
    </div>
  );
}
