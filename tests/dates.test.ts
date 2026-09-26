import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateRange,
  formatMonth,
  formatTimestamp,
  formatTime,
} from "@/lib/dates";

/** §8.12: "Dates read 26 Sept 2026, and times 10:50 pm." */
describe("date formatting", () => {
  it("writes a date the way the design language does", () => {
    expect(formatDate("2026-09-26")).toBe("26 Sept 2026");
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
  });

  it("leaves anything that is not a date alone", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("soon")).toBe("soon");
  });

  it("shares what the two ends of a range have in common", () => {
    expect(formatDateRange("2026-01-23", "2026-01-23")).toBe("23 Jan 2026");
    expect(formatDateRange("2026-01-23", "2026-01-27")).toBe("23 to 27 Jan 2026");
    expect(formatDateRange("2026-01-30", "2026-02-02")).toBe("30 Jan to 2 Feb 2026");
    expect(formatDateRange("2025-12-29", "2026-01-02")).toBe("29 Dec 2025 to 2 Jan 2026");
  });

  it("describes an open-ended validity in words, not as 9999", () => {
    expect(formatDateRange("2024-01-01", "9999-12-31")).toBe("1 Jan 2024 onwards");
  });

  it("names payroll months in full", () => {
    expect(formatMonth(2026, 9)).toBe("September 2026");
  });

  it("shows timestamps in India time, on the Indian date", () => {
    // 18:30 UTC on the 25th is midnight on the 26th in India.
    expect(formatTimestamp("2026-09-25T18:30:00.000Z")).toBe("26 Sept 2026, 12:00 am");
    expect(formatTimestamp("2026-09-26T05:20:00.000Z")).toBe("26 Sept 2026, 10:50 am");
  });

  it("writes clock times on a 12-hour clock", () => {
    expect(formatTime("14:30")).toBe("2:30 pm");
    expect(formatTime("00:05")).toBe("12:05 am");
    expect(formatTime("12:00")).toBe("12:00 pm");
  });
});
