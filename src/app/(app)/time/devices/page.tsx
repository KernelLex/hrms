import { asc } from "drizzle-orm";
import { requirePage } from "@/lib/access";
import { db } from "@/lib/db";
import { ptDevice } from "@/db/schema";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { saveDevice, deleteDevice } from "@/app/actions/attendance";
import { Status } from "@/components/ui";
import { TimeTabs } from "../tabs";

const COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Name" },
  { key: "location", label: "Location" },
  { key: "status", label: "Status" },
];

const FIELDS: FieldDef[] = [
  { kind: "text", name: "code", label: "Code", required: true, placeholder: "GATE-1", uppercase: true },
  { kind: "text", name: "name", label: "Name", required: true, placeholder: "Main gate punch clock" },
  { kind: "text", name: "location", label: "Location", placeholder: "Head office, ground floor" },
  { kind: "checkbox", name: "isActive", label: "Active" },
];

/** TM-08 — punch clocks, and the generic endpoint any middleware calls. */
export default async function DevicesPage() {
  await requirePage(["time.manage"], "/time/my-attendance");
  const devices = await db.select().from(ptDevice).orderBy(asc(ptDevice.code));

  return (
    <>
      <TimeTabs />
      <MasterScreen
        title="Devices"
        subtitle="Punch clocks, and any middleware calling the generic punch endpoint in front of one. CSV and Regularised are built in, for uploads and approved corrections — they cannot be removed."
        entity="device"
        columns={COLUMNS}
        idField="code"
        fields={FIELDS}
        saveAction={saveDevice}
        deleteAction={deleteDevice}
        lockIdOnEdit
        emptyHint="Add a device before its punches can be sent or uploaded."
        rows={devices.map((d) => ({
          id: d.code,
          describe: `${d.code} — ${d.name}`,
          cells: {
            code: <span className="font-medium text-ink">{d.code}</span>,
            name: d.name,
            location: d.location ?? <span className="text-decor">&mdash;</span>,
            status: <Status tone={d.isActive ? "done" : "neutral"}>{d.isActive ? "Active" : "Inactive"}</Status>,
          },
          values: { code: d.code, name: d.name, location: d.location ?? "", isActive: d.isActive },
        }))}
      />
    </>
  );
}
