import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { rawClient } from "@/lib/db";
import {
  saveHolidayCalendar,
  saveHolidayYear,
  deleteHolidayYear,
  copyHolidayYear,
  saveHoliday,
  setOptionalHoliday,
} from "@/app/actions/time";
import { holidayAllowanceFor, workingDaysBetween } from "@/lib/engines/quota";
import { form } from "./support/fixtures";
import { actAs, createPerson, type Person } from "./support/people";
import { createPayrollGroup } from "./support/payroll-fixtures";

/**
 * A holiday list is published one year at a time, and the year carries the
 * cap. The cap covers fixed and chosen days together, so what each person
 * may choose is derived from it — which is the whole point: publishing one
 * more fixed day has to take one off everybody's choice the same moment.
 */

const uid = () => randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
const one = async (sql: string, args: (string | number)[] = []) =>
  (await rawClient().execute({ sql, args })).rows[0] as Record<string, unknown> | undefined;

const YEAR = 2031;

/** A calendar of this test's own, with one year open on it. */
async function calendarWithYear(opts: { total?: number; published?: boolean } = {}) {
  const code = `HY${uid()}`;
  expect((await saveHolidayCalendar({}, form({ code, name: `Holiday year ${code}`, isActive: "on" }))).ok).toBe(true);
  const saved = await saveHolidayYear(
    {},
    form({
      calendarCode: code,
      year: YEAR,
      totalAllowance: opts.total ?? 12,
      ...(opts.published === false ? {} : { isPublished: "on" }),
    }),
  );
  expect(saved.ok, saved.error ?? "").toBe(true);
  return code;
}

const addHoliday = (calendarCode: string, date: string, name: string, optional = false) =>
  saveHoliday({}, form({ date, name, calendarCode, ...(optional ? { isOptional: "on" } : {}) }));

/**
 * Someone whose calendar is this test's own. A calendar hangs off the level
 * flagged for it, not off a department, so the person is moved into a
 * business centre created for the purpose.
 */
async function personOn(calendarCode: string): Promise<Person> {
  const person = await createPerson({ roles: ["EMPLOYEE"] });
  const node = await createPayrollGroup(calendarCode);
  await rawClient().execute({
    sql: "UPDATE pa_it0001_org_assignment SET org_unit_code = ? WHERE employee_id = ?",
    args: [node, person.employeeId],
  });
  return person;
}

afterEach(() => actAs(null));

describe("the year's allowance", () => {
  it("gives what is left after the fixed days, and never less than none", async () => {
    const calendar = await calendarWithYear({ total: 12 });

    expect(await holidayAllowanceFor(calendar, YEAR)).toMatchObject({ total: 12, mandatory: 0, optional: 12 });

    // Ten fixed days leave two to choose.
    for (let i = 1; i <= 10; i += 1) {
      expect((await addHoliday(calendar, `${YEAR}-03-${String(i).padStart(2, "0")}`, `Fixed ${i}`)).ok).toBe(true);
    }
    expect(await holidayAllowanceFor(calendar, YEAR)).toMatchObject({ total: 12, mandatory: 10, optional: 2 });

    // Offering more optional days than that does not raise the allowance.
    for (let i = 1; i <= 6; i += 1) {
      expect((await addHoliday(calendar, `${YEAR}-04-${String(i).padStart(2, "0")}`, `Optional ${i}`, true)).ok).toBe(true);
    }
    expect(await holidayAllowanceFor(calendar, YEAR)).toMatchObject({ total: 12, mandatory: 10, optional: 2 });

    // And publishing beyond the cap takes the choice away rather than the
    // fixed days: 13 fixed under a cap of 12 leaves nothing to choose.
    for (let i = 11; i <= 13; i += 1) {
      expect((await addHoliday(calendar, `${YEAR}-03-${String(i).padStart(2, "0")}`, `Fixed ${i}`)).ok).toBe(true);
    }
    expect(await holidayAllowanceFor(calendar, YEAR)).toMatchObject({ total: 12, mandatory: 13, optional: 0 });
  });

  it("counts only its own calendar and its own year", async () => {
    const mine = await calendarWithYear({ total: 12 });
    const theirs = await calendarWithYear({ total: 12 });
    expect((await addHoliday(mine, `${YEAR}-01-26`, "Republic Day")).ok).toBe(true);
    expect((await addHoliday(theirs, `${YEAR}-01-26`, "Republic Day")).ok).toBe(true);
    expect((await addHoliday(theirs, `${YEAR}-08-15`, "Independence Day")).ok).toBe(true);

    expect((await holidayAllowanceFor(mine, YEAR))?.mandatory).toBe(1);
    expect((await holidayAllowanceFor(theirs, YEAR))?.mandatory).toBe(2);
    expect(await holidayAllowanceFor(mine, YEAR + 1)).toBeNull();
  });
});

describe("a year has to exist first", () => {
  it("refuses a holiday in a year nobody opened, and takes it once they have", async () => {
    const calendar = await calendarWithYear();

    const early = await addHoliday(calendar, `${YEAR + 5}-01-01`, "Too early");
    expect(early.error).toMatch(new RegExp(`no ${YEAR + 5} yet`));

    expect((await saveHolidayYear({}, form({ calendarCode: calendar, year: YEAR + 5, totalAllowance: 12, isPublished: "on" }))).ok).toBe(true);
    expect((await addHoliday(calendar, `${YEAR + 5}-01-01`, "New Year")).ok).toBe(true);
    expect(Number((await one("SELECT year FROM pt_holiday WHERE calendar_code = ? AND date = ?", [calendar, `${YEAR + 5}-01-01`]))?.year)).toBe(YEAR + 5);
  });

  it("will not remove a year that still has days on it", async () => {
    const calendar = await calendarWithYear();
    expect((await addHoliday(calendar, `${YEAR}-01-26`, "Republic Day")).ok).toBe(true);

    const refused = await deleteHolidayYear({}, form({ calendarCode: calendar, year: YEAR }));
    expect(refused.error).toMatch(/still has 1 day/);

    await rawClient().execute({ sql: "DELETE FROM pt_holiday WHERE calendar_code = ?", args: [calendar] });
    expect((await deleteHolidayYear({}, form({ calendarCode: calendar, year: YEAR }))).ok).toBe(true);
  });
});

describe("copying a year forward", () => {
  it("brings the same days a year later, and adds nothing the second time", async () => {
    const calendar = await calendarWithYear();
    expect((await addHoliday(calendar, `${YEAR}-01-26`, "Republic Day")).ok).toBe(true);
    expect((await addHoliday(calendar, `${YEAR}-03-25`, "Holi", true)).ok).toBe(true);
    expect((await saveHolidayYear({}, form({ calendarCode: calendar, year: YEAR + 1, totalAllowance: 12, isPublished: "on" }))).ok).toBe(true);

    const copied = await copyHolidayYear({}, form({ calendarCode: calendar, year: YEAR + 1, fromYear: YEAR }));
    expect(copied.ok, copied.error ?? "").toBe(true);

    const next = await rawClient().execute({
      sql: "SELECT date, name, is_optional FROM pt_holiday WHERE calendar_code = ? AND year = ? ORDER BY date",
      args: [calendar, YEAR + 1],
    });
    expect(next.rows.map((r) => [String(r.date), String(r.name), Number(r.is_optional)])).toEqual([
      [`${YEAR + 1}-01-26`, "Republic Day", 0],
      [`${YEAR + 1}-03-25`, "Holi", 1],
    ]);

    // The optional one came across as optional, so the allowance follows.
    expect(await holidayAllowanceFor(calendar, YEAR + 1)).toMatchObject({ mandatory: 1, optional: 11 });

    const again = await copyHolidayYear({}, form({ calendarCode: calendar, year: YEAR + 1, fromYear: YEAR }));
    expect(again.error).toMatch(/already has every day/);
  });
});

describe("choosing an optional holiday", () => {
  let employee: Person;

  it("is allowed up to what the year leaves, and refused past it", async () => {
    const calendar = await calendarWithYear({ total: 2 });
    employee = await personOn(calendar);

    // One fixed day under a cap of two leaves exactly one to choose.
    expect((await addHoliday(calendar, `${YEAR}-01-26`, "Republic Day")).ok).toBe(true);
    for (const [date, name] of [
      [`${YEAR}-03-25`, "Holi"],
      [`${YEAR}-09-05`, "Onam"],
    ]) {
      expect((await addHoliday(calendar, date, name, true)).ok).toBe(true);
    }
    expect(await holidayAllowanceFor(calendar, YEAR)).toMatchObject({ total: 2, mandatory: 1, optional: 1 });

    const holi = Number((await one("SELECT id FROM pt_holiday WHERE calendar_code = ? AND date = ?", [calendar, `${YEAR}-03-25`]))!.id);
    const onam = Number((await one("SELECT id FROM pt_holiday WHERE calendar_code = ? AND date = ?", [calendar, `${YEAR}-09-05`]))!.id);

    actAs(employee.session);
    expect((await setOptionalHoliday({}, form({ holidayId: holi, take: 1 }))).ok).toBe(true);
    const over = await setOptionalHoliday({}, form({ holidayId: onam, take: 1 }));
    expect(over.error).toMatch(/you may choose 1/);
    actAs(null);

    // The fixed day is still everybody's, and the chosen one is not a
    // company holiday: working days are unchanged by the choice.
    const working = await workingDaysBetween(`${YEAR}-01-26`, `${YEAR}-01-26`, calendar);
    expect(working).toBe(0);
    const stillWorking = await workingDaysBetween(`${YEAR}-09-05`, `${YEAR}-09-05`, calendar);
    expect(stillWorking).toBe(1);
  });

  it("is refused while the year is still a draft", async () => {
    const calendar = await calendarWithYear({ total: 12, published: false });
    expect((await addHoliday(calendar, `${YEAR}-03-25`, "Holi", true)).ok).toBe(true);
    const holi = Number((await one("SELECT id FROM pt_holiday WHERE calendar_code = ? AND date = ?", [calendar, `${YEAR}-03-25`]))!.id);

    const person = await personOn(calendar);

    actAs(person.session);
    const refused = await setOptionalHoliday({}, form({ holidayId: holi, take: 1 }));
    expect(refused.error).toMatch(/still a draft/);
    actAs(null);
  });
});
