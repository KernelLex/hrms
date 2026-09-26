import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appDocument, rcCandidate } from "@/db/schema";
import {
  recognise,
  safeFileName,
  storeDocument,
  readDocument,
  deleteDocument,
  storageDriver,
} from "@/lib/storage";
import { uploadResume, deleteCandidate, saveCandidate } from "@/app/actions/recruitment";
import { form } from "./support/fixtures";

/** Document storage: what is accepted, the database driver, and R2's requests. */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]); // "%PDF-1.7\n"
const pdfFile = (name = "resume.pdf") => new File([PDF], name, { type: "application/pdf" });

describe("what may be uploaded", () => {
  it("recognises a PDF by its content, not its name alone", () => {
    expect(recognise(PDF, "cv.pdf")?.type).toBe("application/pdf");
    expect(recognise(PDF, "cv.docx")).toBeNull(); // PDF bytes under a Word name
    expect(recognise(new TextEncoder().encode("<script>"), "cv.pdf")).toBeNull();
  });

  it("makes file names safe to send back in a header", () => {
    expect(safeFileName('..\\..\\evil"name.pdf')).toBe(".._.._evilname.pdf");
    expect(safeFileName("")).toBe("document");
  });
});

describe("the database driver", () => {
  it("stores, reads back and deletes a file", async () => {
    expect(storageDriver()).toBe("database");
    const doc = await storeDocument({
      ownerType: "candidate",
      ownerId: 999_001,
      kind: "Resume",
      file: pdfFile(),
      uploadedBy: "test",
    });
    expect(doc).toMatchObject({ storage: "database", contentType: "application/pdf", sizeBytes: PDF.length });

    const body = await readDocument(doc);
    expect(body?.kind).toBe("bytes");
    expect(Array.from((body as { bytes: Uint8Array }).bytes)).toEqual(Array.from(PDF));

    await deleteDocument(doc);
    expect(await db.query.appDocument.findFirst({ where: eq(appDocument.id, doc.id) })).toBeUndefined();
  });

  it("replaces a candidate's resume, and removes it with the candidate", async () => {
    await saveCandidate({}, form({ fullName: "Test Resume", email: "resume@example.com", source: "Referral" }));
    const candidate = await db.query.rcCandidate.findFirst({ where: eq(rcCandidate.email, "resume@example.com") });
    expect(candidate).toBeDefined();

    const upload = (name: string) => {
      const f = new FormData();
      f.set("candidateId", String(candidate!.id));
      f.set("file", pdfFile(name));
      return uploadResume({}, f);
    };
    expect((await upload("first.pdf")).error).toBeUndefined();
    expect((await upload("second.pdf")).error).toBeUndefined();

    const docs = await db.select().from(appDocument).where(eq(appDocument.ownerId, candidate!.id));
    expect(docs.map((d) => d.fileName)).toEqual(["second.pdf"]);

    const refused = new FormData();
    refused.set("candidateId", String(candidate!.id));
    refused.set("file", new File(["not a pdf"], "fake.pdf"));
    expect((await uploadResume({}, refused)).error).toMatch(/PDF or Word/);

    await deleteCandidate({}, form({ code: candidate!.code }));
    expect(await db.select().from(appDocument).where(eq(appDocument.ownerId, candidate!.id))).toHaveLength(0);
  });

  it("refuses a resume link that is not a web address", async () => {
    const result = await saveCandidate(
      {},
      form({ fullName: "Link Test", email: "link@example.com", source: "Referral", resumeLink: "javascript:alert(1)" }),
    );
    expect(result.error).toMatch(/http/);
  });
});

describe("the R2 driver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete process.env[k];
  });

  it("signs uploads for the bucket and hands out short-lived download links", async () => {
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "acct123",
      R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "hrms-docs",
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(storageDriver()).toBe("r2");
    const doc = await storeDocument({
      ownerType: "candidate",
      ownerId: 999_002,
      kind: "Resume",
      file: pdfFile(),
      uploadedBy: "test",
    });
    expect(doc.storage).toBe("r2");

    const request = (fetchMock.mock.calls[0] as unknown as [Request])[0];
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(`https://acct123.r2.cloudflarestorage.com/hrms-docs/${doc.storageKey}`);
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);

    const body = await readDocument(doc);
    expect(body?.kind).toBe("redirect");
    const url = new URL((body as { url: string }).url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);

    await deleteDocument(doc);
    const del = (fetchMock.mock.calls.at(-1) as unknown as [Request])[0];
    expect(del.method).toBe("DELETE");
  });
});
