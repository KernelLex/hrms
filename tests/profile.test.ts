import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, rawClient } from "@/lib/db";
import { appDocument, paEmployee } from "@/db/schema";
import { getProfile, maskAccount } from "@/lib/repositories/profile";
import { uploadEmployeeDocument, removeEmployeeDocument } from "@/app/actions/documents";

/** The employee's own profile and the documents HR files for them. */

async function employeeId(number: string) {
  const e = await db.query.paEmployee.findFirst({ where: eq(paEmployee.employeeNumber, number) });
  return e!.id;
}

describe("my profile", () => {
  it("never shows a whole bank account number", () => {
    expect(maskAccount("123456789012")).toBe("••••••••9012");
    expect(maskAccount("12345")).toBe("••••2345");
  });

  it("names the manager through the reporting line", async () => {
    const arjun = await employeeId("EMP1001");
    const profile = await getProfile(arjun, "2026-09-26");
    expect(profile?.managerName).toBe("Ravi Kumar");
    expect(profile?.bank?.accountEnding).toMatch(/^•+\d{4}$/);
  });

  it("lists reads by other people, not the person's own", async () => {
    const arjun = await employeeId("EMP1001");
    const users = await rawClient().execute(
      "SELECT id, username, employee_id FROM sec_app_user WHERE username IN ('hr.admin', 'arjun.mehta')",
    );
    const hr = users.rows.find((u) => u.username === "hr.admin")!;
    const self = users.rows.find((u) => u.username === "arjun.mehta")!;
    for (const u of [hr, self]) {
      await rawClient().execute({
        sql: `INSERT INTO app_access_log (at, user_id, username, subject_employee_id, resource)
              VALUES (?, ?, ?, ?, 'payslip')`,
        args: [new Date().toISOString(), u.id, u.username, arjun],
      });
    }
    const profile = await getProfile(arjun, "2026-09-26");
    expect(profile?.viewedBy.map((v) => v.name)).toContain("Priya Sharma");
    expect(profile?.viewedBy.map((v) => v.name)).not.toContain("Arjun Mehta");
  });
});

describe("employee documents", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  it("accepts a photographed identity proof and removes it again", async () => {
    const arjun = await employeeId("EMP1001");
    const f = new FormData();
    f.set("employeeId", String(arjun));
    f.set("kind", "Identity proof");
    f.set("file", new File([PNG], "aadhaar.png", { type: "image/png" }));
    expect((await uploadEmployeeDocument({}, f)).error).toBeUndefined();

    const doc = await db.query.appDocument.findFirst({ where: eq(appDocument.fileName, "aadhaar.png") });
    expect(doc).toMatchObject({ ownerType: "employee", ownerId: arjun, contentType: "image/png" });

    const r = new FormData();
    r.set("documentId", String(doc!.id));
    expect((await removeEmployeeDocument({}, r)).error).toBeUndefined();
  });

  it("refuses a kind of document it does not know", async () => {
    const arjun = await employeeId("EMP1001");
    const f = new FormData();
    f.set("employeeId", String(arjun));
    f.set("kind", "Something else");
    f.set("file", new File([PNG], "x.png"));
    expect((await uploadEmployeeDocument({}, f)).error).toMatch(/kind of document/);
  });
});
