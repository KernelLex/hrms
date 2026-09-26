"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** Printing is the browser's job; §8.11 supplies the stylesheet. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()} className="no-print">
      <Printer />
      {label}
    </Button>
  );
}
