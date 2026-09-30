"use client";

import { usePathname } from "next/navigation";
import { Tabs, Tab } from "@/components/ui";

const ITEMS = [
  { href: "/time/absences", label: "Absences" },
  { href: "/time/calendar", label: "Calendar" },
  { href: "/time/attendances", label: "Attendance" },
  { href: "/time/quotas", label: "Quotas" },
  { href: "/time/evaluation", label: "Time evaluation" },
  { href: "/time/schedules", label: "Work schedules" },
  { href: "/time/holidays", label: "Holidays" },
  { href: "/time/holiday-calendars", label: "Holiday calendars" },
  { href: "/time/leave-policies", label: "Leave policies" },
  { href: "/time/shifts", label: "Shifts" },
  { href: "/time/roster-patterns", label: "Roster patterns" },
  { href: "/time/roster", label: "Roster" },
  { href: "/time/attendance-board", label: "Today's board" },
  { href: "/time/devices", label: "Devices" },
];

export function TimeTabs({ counts }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <Tabs>
      {ITEMS.map((i) => (
        <Tab
          key={i.href}
          href={i.href}
          active={pathname === i.href}
          count={counts?.[i.href]}
        >
          {i.label}
        </Tab>
      ))}
    </Tabs>
  );
}
