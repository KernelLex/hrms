import { beforeAll, describe, expect, it } from "vitest";
import {
  saveTimeSlice,
  readAsOf,
  readHistory,
  deleteTimeSlice,
  SLICED_TABLES,
} from "@/lib/engines/timeslice";
import { createBareEmployee } from "./support/fixtures";

/**
 * The time-slice engine: every fact about a person is a dated record, and
 * writing one delimits whatever was true before it.
 *
 * The tests run in order against one employee, because each case builds on
 * the history the previous one left — which is how the engine is used.
 */

type Slice = { id: number; valid_from: string; valid_to: string; amount_paise: number };

let employeeId: number;

const pay = (amount: number, from: string, to?: string) =>
  saveTimeSlice({
    table: SLICED_TABLES.basicPay,
    employeeId,
    validFrom: from,
    validTo: to,
    data: {
      pay_scale_type: "Monthly salaried",
      pay_scale_area: null,
      pay_scale_group: "L1",
      amount_paise: amount,
      currency: "INR",
    },
    createdBy: "test",
  });

const history = () => readHistory<Slice>(SLICED_TABLES.basicPay, employeeId);
const asOf = (date: string) => readAsOf<Slice>(SLICED_TABLES.basicPay, employeeId, date);

describe("time-slice engine", () => {
  beforeAll(async () => {
    employeeId = await createBareEmployee("ZZTS");
  });

  it("delimits the predecessor when a later record is written", async () => {
    await pay(1_000_000, "2020-01-01");
    await pay(2_000_000, "2022-01-01");

    const first = (await history()).find((h) => h.valid_from === "2020-01-01");
    expect(first?.valid_to).toBe("2021-12-31");
  });

  it("reads what was true on a past date, not what is true now", async () => {
    expect(Number((await asOf("2021-06-01"))?.amount_paise)).toBe(1_000_000);
    expect(Number((await asOf("2023-06-01"))?.amount_paise)).toBe(2_000_000);
  });

  it("splits an open-ended record in three for a short correction inside it", async () => {
    await pay(9_900_000, "2023-03-01", "2023-03-31");

    const h = await history();
    const before = h.find((x) => x.valid_from === "2022-01-01");
    const inserted = h.find((x) => x.valid_from === "2023-03-01");
    const after = h.find((x) => x.valid_from === "2023-04-01");

    expect(before?.valid_to).toBe("2023-02-28");
    expect(inserted?.valid_to).toBe("2023-03-31");
    expect(after?.valid_to).toBe("9999-12-31");
    expect(Number(after?.amount_paise)).toBe(2_000_000);
  });

  it("keeps the original value in the period after a correction", async () => {
    expect(Number((await asOf("2023-06-01"))?.amount_paise)).toBe(2_000_000);
  });

  it("heals the gap when a slice is deleted", async () => {
    const inserted = (await history()).find((x) => x.valid_from === "2023-03-01");
    expect(inserted).toBeDefined();
    await deleteTimeSlice(SLICED_TABLES.basicPay, Number(inserted!.id));

    const healed = await asOf("2023-03-15");
    expect(healed?.valid_from).toBe("2022-01-01");
  });

  it("leaves no overlapping slices", async () => {
    const sorted = [...(await history())].sort((a, b) =>
      a.valid_from < b.valid_from ? -1 : 1,
    );
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i].valid_from > sorted[i - 1].valid_to).toBe(true);
    }
  });
});
