import { describe, expect, it } from "vitest";
import { rawClient } from "@/lib/db";
import { saveInfotypeSlice, deleteInfotypeSlice, setEmploymentStatus } from "@/app/actions/core-hr";
import { saveHoliday } from "@/app/actions/time";
import { diff } from "@/lib/change-log";
import { describeChange, formatValue } from "@/lib/change-format";
import { listChanges } from "@/lib/repositories/change-log";
import { createBareEmployee, form } from "./support/fixtures";

/**
 * The change log: every write says who made it and what it was before and
 * after, in the same commit as the write itself, and reads back as words.
 */

async function logFor(employeeId: number) {
  return (await listChanges({ subjectEmployeeId: employeeId }, 100)).rows.reverse();
}

describe("recording changes", () => {
  it("shows a salary change with the figure before and after", async () => {
    const id = await createBareEmployee("CL");
    const pay = (validFrom: string, amount: number) =>
      saveInfotypeSlice(
        {},
        form({ employeeId: id, infotype: "0008", validFrom, amount, payScaleGroup: "L2", currency: "INR" }),
      );
    expect(await pay("2024-04-01", 65_000)).toEqual({ ok: true });
    expect(await pay("2025-04-01", 72_000)).toEqual({ ok: true });

    const log = await logFor(id);
    const raise = log.at(-1)!;
    expect(raise.entity).toBe("pa_it0008_basic_pay");
    expect(raise.action).toBe("create");
    expect(raise.actorName).toBe("hr.admin");
    expect(raise.before).toEqual({ amount_paise: 6_500_000 });
    expect(raise.after?.amount_paise).toBe(7_200_000);

    const described = describeChange(raise);
    expect(described.title).toBe("Basic pay from 1 Apr 2025");
    expect(described.lines).toEqual([{ label: "Amount", before: "₹65,000", after: "₹72,000" }]);

    // The earlier record was closed the day before, and that is logged too.
    const closed = log.find((e) => e.action === "update" && e.entity === "pa_it0008_basic_pay")!;
    expect(describeChange(closed).title).toBe("Basic pay closed");
    expect(closed.after).toEqual({ valid_to: "2025-03-31" });
  });

  it("never keeps a full bank account number", async () => {
    const id = await createBareEmployee("CL");
    await saveInfotypeSlice(
      {},
      form({ employeeId: id, infotype: "0009", validFrom: "2024-01-01", bankName: "HDFC", accountNumber: "501002345678", ifsc: "HDFC0001234" }),
    );
    const [entry] = await logFor(id);
    expect(entry.after?.account_number).toBe("••••5678");
    const r = await rawClient().execute({
      sql: "SELECT after FROM app_change_log WHERE subject_employee_id = ?",
      args: [id],
    });
    expect(String(r.rows[0].after)).not.toContain("501002345678");
  });

  it("records a deletion with what was deleted", async () => {
    const id = await createBareEmployee("CL");
    await saveInfotypeSlice({}, form({ employeeId: id, infotype: "0008", validFrom: "2024-01-01", amount: 50_000 }));
    const slice = await rawClient().execute({
      sql: "SELECT id FROM pa_it0008_basic_pay WHERE employee_id = ?",
      args: [id],
    });
    await deleteInfotypeSlice({}, form({ employeeId: id, infotype: "0008", id: Number(slice.rows[0].id) }));

    const removed = (await logFor(id)).at(-1)!;
    expect(removed.action).toBe("delete");
    expect(removed.before?.amount_paise).toBe(5_000_000);
    expect(describeChange(removed).title).toBe("Basic pay removed");
  });

  it("logs only the fields that changed, and nothing for a save that changes nothing", async () => {
    const id = await createBareEmployee("CL");
    await setEmploymentStatus({}, form({ employeeId: id, status: "On leave" }));
    await setEmploymentStatus({}, form({ employeeId: id, status: "On leave" }));

    const log = await logFor(id);
    expect(log).toHaveLength(1);
    expect(log[0].before).toEqual({ employment_status: "Active" });
    expect(log[0].after).toEqual({ employment_status: "On leave" });
  });

  it("logs master data that belongs to nobody in particular", async () => {
    await saveHoliday({}, form({ date: "2031-01-26", name: "Republic Day", calendarCode: "NATIONAL" }));
    const { rows } = await listChanges({ entity: "pt_holiday" }, 10);
    expect(rows[0].after).toMatchObject({ date: "2031-01-26", name: "Republic Day" });
    expect(rows[0].subjectEmployeeId).toBeNull();
  });

  it("filters by date in India time", async () => {
    const at = "2031-06-30T20:00:00.000Z"; // 1 July, 1:30 am in India
    await rawClient().execute({
      sql: `INSERT INTO app_change_log (at, actor_type, actor_name, entity, entity_id, action, after)
            VALUES (?, 'user', 'tz.check', 'om_job', 'JBTZ', 'create', '{}')`,
      args: [at],
    });
    const july = await listChanges({ actor: "tz.check", from: "2031-07-01", to: "2031-07-01" });
    const june = await listChanges({ actor: "tz.check", from: "2031-06-30", to: "2031-06-30" });
    expect(july.total).toBe(1);
    expect(june.total).toBe(0);
  });
});

describe("reading changes", () => {
  it("diffs only what moved, treating 1 and true as the same", () => {
    expect(diff({ isActive: true, name: "A" }, { is_active: 1, name: "A" })).toBeUndefined();
    expect(diff({ name: "A", city: null }, { name: "B", city: null })).toEqual({
      before: { name: "A" },
      after: { name: "B" },
    });
  });

  it("formats values the way a person writes them", () => {
    expect(formatValue("amount_paise", 7_200_000)).toBe("₹72,000");
    expect(formatValue("amount_paise", 7_200_050)).toBe("₹72,000.50");
    expect(formatValue("valid_to", "9999-12-31")).toBe("open-ended");
    expect(formatValue("valid_from", "2025-04-01")).toBe("1 Apr 2025");
    expect(formatValue("is_vacant", 0)).toBe("No");
    expect(formatValue("used_half_days", 3)).toBe("1.5 days");
    expect(formatValue("increment_basis_points", 900)).toBe("9%");
    expect(formatValue("reason", null)).toBe("—");
  });

  it("describes a creation by its fields, leaving out the housekeeping", () => {
    const d = describeChange({
      entity: "om_job",
      action: "create",
      before: null,
      after: { code: "JB9", title: "Analyst", created_at: "x", id: 3 },
    });
    expect(d.title).toBe("Job added");
    expect(d.lines).toEqual([
      { label: "Code", after: "JB9" },
      { label: "Title", after: "Analyst" },
    ]);
  });
});
