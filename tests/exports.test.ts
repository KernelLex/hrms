import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";
import { GET as exportEmployees } from "@/app/api/export/employees/route";
import { GET as exportRun } from "@/app/api/export/payroll-run/[id]/route";
import { runPayroll } from "@/lib/engines/payroll";
import { createArea, createPeriod, hireForPayroll } from "./support/payroll-fixtures";

/** CSV downloads: safe to open in a spreadsheet, and complete. */
describe("CSV", () => {
  it("stops text being run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
  });

  it("leaves numbers as numbers, negative ones included", () => {
    expect(csvCell(-1250.5)).toBe("-1250.5");
    expect(toCsv([["a", 1], [null, "b,c"]])).toBe('a,1\r\n,"b,c"\r\n');
  });
});

describe("exports", () => {
  it("exports the employee list with its filters", async () => {
    const res = await exportEmployees(new Request("http://test/api/export/employees?q=arjun"));
    expect(res.headers.get("content-type")).toMatch(/text\/csv/);
    const text = (await res.text()).replace(/^﻿/, "");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Employee number,Name,/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("EMP1001");
  });

  it("puts each wage type in its own column, and the columns add up", async () => {
    const area = await createArea();
    await hireForPayroll({ area, hireDate: "2020-01-01", pay: [{ from: "2020-01-01", amountRupees: 50_000 }] });
    const periodId = await createPeriod(area, 2026, 5);
    const { runId } = await runPayroll({ periodId, runBy: "test" });

    const res = await exportRun(new Request(`http://test/api/export/payroll-run/${runId}`), {
      params: Promise.resolve({ id: String(runId) }),
    } as never);
    const [header, row] = (await res.text()).replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(","));
    const col = (name: string) => Number(row[header.indexOf(name)]);
    expect(col("BASIC (earning)")).toBe(50_000);
    expect(col("HRA (earning)")).toBe(20_000);
    expect(col("BASIC (earning)") + col("HRA (earning)") + col("CONV (earning)")).toBe(col("Gross"));
    expect(col("Gross") - col("Deductions")).toBe(col("Net"));
  });
});
