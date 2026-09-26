import { notFound } from "next/navigation";
import { asc, eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  omCompany,
  omPersonnelArea,
  omPersonnelSubArea,
  omOrgUnit,
  omPosition,
  ptWorkScheduleRule,
  paAddress,
  paFamilyMember,
  paCommunication,
} from "@/db/schema";
import { readHistory, SLICED_TABLES } from "@/lib/engines/timeslice";
import { infotypeByCode, infotypeFields } from "@/lib/infotypes";
import { InfotypeEditor, type HistoryRow } from "@/components/infotype-editor";
import {
  saveInfotypeSlice,
  deleteInfotypeSlice,
  saveRepeatingInfotype,
  deleteRepeatingInfotype,
} from "@/app/actions/core-hr";
import { formatINR, toRupees } from "@/lib/money";

/** CH-02 — maintain HR master data, one infotype per tab. */
export default async function InfotypePage(props: {
  params: Promise<{ id: string; infotype: string }>;
}) {
  const { id, infotype } = await props.params;
  const employeeId = Number(id);
  const meta = infotypeByCode(infotype);
  if (!meta) notFound();

  const [companies, areas, subAreas, units, positions, schedules] = await Promise.all([
    db.select().from(omCompany).orderBy(asc(omCompany.code)),
    db.select().from(omPersonnelArea).orderBy(asc(omPersonnelArea.code)),
    db.select().from(omPersonnelSubArea).orderBy(asc(omPersonnelSubArea.code)),
    db.select().from(omOrgUnit).orderBy(asc(omOrgUnit.code)),
    db.select().from(omPosition).orderBy(asc(omPosition.code)),
    db.select().from(ptWorkScheduleRule).orderBy(asc(ptWorkScheduleRule.code)),
  ]);

  const refs = {
    companies: companies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` })),
    areas: areas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
    subAreas: subAreas.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` })),
    units: units.map((u) => ({ value: u.code, label: `${u.code} — ${u.name}` })),
    positions: positions.map((p) => ({ value: p.code, label: `${p.code} — ${p.title}` })),
    schedules: schedules.map((w) => ({ value: w.code, label: w.name })),
  };

  const fields = infotypeFields(infotype, refs);
  const dash = <span className="text-decor">&mdash;</span>;

  let columns: { key: string; label: string; numeric?: boolean }[] = [];
  let rows: HistoryRow[] = [];

  if (meta.kind === "sliced") {
    const table = {
      "0001": SLICED_TABLES.orgAssignment,
      "0002": SLICED_TABLES.personalData,
      "0007": SLICED_TABLES.plannedWorkingTime,
      "0008": SLICED_TABLES.basicPay,
      "0009": SLICED_TABLES.bankDetails,
    }[infotype]!;

    const history = await readHistory<Record<string, string | number | null>>(
      table,
      employeeId,
    );

    if (infotype === "0002") {
      columns = [
        { key: "name", label: "Name" },
        { key: "dob", label: "Date of birth" },
        { key: "gender", label: "Gender" },
        { key: "marital", label: "Marital status" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        validFrom: String(h.valid_from),
        validTo: String(h.valid_to),
        describe: `${h.first_name} ${h.last_name}, valid from ${h.valid_from}`,
        cells: {
          name: <span className="font-medium text-ink">{`${h.first_name} ${h.last_name}`}</span>,
          dob: h.date_of_birth ? <span className="tabular">{String(h.date_of_birth)}</span> : dash,
          gender: h.gender ?? dash,
          marital: h.marital_status ?? dash,
        },
        values: {
          firstName: String(h.first_name ?? ""),
          lastName: String(h.last_name ?? ""),
          dateOfBirth: String(h.date_of_birth ?? ""),
          gender: String(h.gender ?? ""),
          maritalStatus: String(h.marital_status ?? ""),
          nationality: String(h.nationality ?? ""),
        },
      }));
    } else if (infotype === "0001") {
      columns = [
        { key: "position", label: "Position" },
        { key: "unit", label: "Department" },
        { key: "company", label: "Company" },
        { key: "cc", label: "Cost centre" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        validFrom: String(h.valid_from),
        validTo: String(h.valid_to),
        describe: `Assignment to ${h.position_code}, valid from ${h.valid_from}`,
        cells: {
          position: <span className="font-medium text-ink">{String(h.position_code)}</span>,
          unit: String(h.org_unit_code),
          company: String(h.company_code),
          cc: h.cost_center ?? dash,
        },
        values: {
          companyCode: String(h.company_code ?? ""),
          areaCode: String(h.area_code ?? ""),
          subAreaCode: String(h.sub_area_code ?? ""),
          orgUnitCode: String(h.org_unit_code ?? ""),
          positionCode: String(h.position_code ?? ""),
          costCenter: String(h.cost_center ?? ""),
        },
      }));
    } else if (infotype === "0007") {
      columns = [
        { key: "schedule", label: "Work schedule" },
        { key: "hours", label: "Weekly hours", numeric: true },
        { key: "pct", label: "Employment %", numeric: true },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        validFrom: String(h.valid_from),
        validTo: String(h.valid_to),
        describe: `Working time from ${h.valid_from}`,
        cells: {
          schedule:
            schedules.find((s) => s.code === h.work_schedule_code)?.name ??
            String(h.work_schedule_code),
          hours: String(h.weekly_hours),
          pct: String(h.employment_percent),
        },
        values: {
          workScheduleCode: String(h.work_schedule_code ?? ""),
          weeklyHours: String(h.weekly_hours ?? ""),
          employmentPercent: String(h.employment_percent ?? ""),
        },
      }));
    } else if (infotype === "0008") {
      columns = [
        { key: "amount", label: "Basic salary", numeric: true },
        { key: "group", label: "Pay scale group" },
        { key: "source", label: "Source" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        validFrom: String(h.valid_from),
        validTo: String(h.valid_to),
        describe: `${formatINR(Number(h.amount_paise))} from ${h.valid_from}`,
        cells: {
          amount: (
            <span className="font-medium text-ink">{formatINR(Number(h.amount_paise))}</span>
          ),
          group: h.pay_scale_group ?? dash,
          source: h.source_ref ? (
            <span className="text-secondary">{String(h.source_ref)}</span>
          ) : (
            dash
          ),
        },
        values: {
          payScaleType: String(h.pay_scale_type ?? ""),
          payScaleArea: String(h.pay_scale_area ?? ""),
          payScaleGroup: String(h.pay_scale_group ?? ""),
          amount: String(toRupees(Number(h.amount_paise))),
          currency: String(h.currency ?? "INR"),
        },
      }));
    } else {
      columns = [
        { key: "bank", label: "Bank" },
        { key: "account", label: "Account" },
        { key: "ifsc", label: "IFSC" },
        { key: "holder", label: "Holder" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        validFrom: String(h.valid_from),
        validTo: String(h.valid_to),
        describe: `${h.bank_name} account from ${h.valid_from}`,
        cells: {
          bank: <span className="font-medium text-ink">{String(h.bank_name)}</span>,
          account: <span className="tabular">{String(h.account_number)}</span>,
          ifsc: h.ifsc ?? dash,
          holder: h.holder_name ?? dash,
        },
        values: {
          bankName: String(h.bank_name ?? ""),
          accountNumber: String(h.account_number ?? ""),
          ifsc: String(h.ifsc ?? ""),
          holderName: String(h.holder_name ?? ""),
        },
      }));
    }
  } else {
    if (infotype === "0006") {
      const history = await db
        .select()
        .from(paAddress)
        .where(eq(paAddress.employeeId, employeeId))
        .orderBy(desc(paAddress.validFrom));
      columns = [
        { key: "type", label: "Type" },
        { key: "address", label: "Address" },
        { key: "city", label: "City" },
        { key: "postal", label: "Postal code" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        describe: `${h.addressType} address, ${h.line}`,
        cells: {
          type: <span className="font-medium text-ink">{h.addressType}</span>,
          address: h.line,
          city: h.city ?? dash,
          postal: h.postalCode ? <span className="tabular">{h.postalCode}</span> : dash,
        },
        values: {
          addressType: h.addressType,
          line: h.line,
          city: h.city ?? "",
          state: h.state ?? "",
          postalCode: h.postalCode ?? "",
          country: h.country ?? "",
        },
      }));
    } else if (infotype === "0021") {
      const history = await db
        .select()
        .from(paFamilyMember)
        .where(eq(paFamilyMember.employeeId, employeeId))
        .orderBy(asc(paFamilyMember.relationship));
      columns = [
        { key: "relationship", label: "Relationship" },
        { key: "name", label: "Name" },
        { key: "dob", label: "Date of birth" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        describe: `${h.relationship}, ${h.name}`,
        cells: {
          relationship: <span className="font-medium text-ink">{h.relationship}</span>,
          name: h.name,
          dob: h.dateOfBirth ? <span className="tabular">{h.dateOfBirth}</span> : dash,
        },
        values: {
          relationship: h.relationship,
          name: h.name,
          dateOfBirth: h.dateOfBirth ?? "",
        },
      }));
    } else {
      const history = await db
        .select()
        .from(paCommunication)
        .where(eq(paCommunication.employeeId, employeeId))
        .orderBy(asc(paCommunication.seq));
      columns = [
        { key: "type", label: "Type" },
        { key: "value", label: "Value" },
      ];
      rows = history.map((h) => ({
        id: String(h.id),
        describe: `${h.commType}, ${h.value}`,
        cells: {
          type: <span className="font-medium text-ink">{h.commType}</span>,
          value: h.value,
        },
        values: { commType: h.commType, value: h.value },
      }));
    }
  }

  return (
    <InfotypeEditor
      employeeId={employeeId}
      code={infotype}
      name={`IT${infotype} — ${meta.name}`}
      description={meta.description}
      sliced={meta.kind === "sliced"}
      fields={fields}
      columns={columns}
      rows={rows}
      saveAction={meta.kind === "sliced" ? saveInfotypeSlice : saveRepeatingInfotype}
      deleteAction={meta.kind === "sliced" ? deleteInfotypeSlice : deleteRepeatingInfotype}
    />
  );
}
