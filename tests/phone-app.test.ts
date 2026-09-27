import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { generateImageMetadata } from "@/app/icon";

/**
 * What installing on a phone needs: a manifest Android and iOS accept, the
 * icons it names, and a service worker that keeps the app's code but never
 * a page or an answer with someone's data in it.
 */

describe("the installable app", () => {
  it("has a manifest a phone accepts, naming icons that exist", () => {
    const m = manifest();
    expect(m).toMatchObject({ name: "HRMS", start_url: "/", display: "standalone" });
    const icons = m.icons ?? [];
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    const generated = generateImageMetadata().map((i) => `/icon/${i.id}`);
    for (const icon of icons) expect(generated).toContain(icon.src);
  });

  it("caches only the app's own code, never pages, data or documents", () => {
    const sw = fs.readFileSync(path.resolve(import.meta.dirname, "../public/sw.js"), "utf8");
    // Exactly one place stores anything, and it is guarded by the static-file test.
    const puts = sw.split("cache.put(").length - 1;
    expect(puts).toBe(1);
    const guarded = sw.slice(0, sw.indexOf("cache.put("));
    expect(guarded).toMatch(/url\.pathname\.startsWith\("\/_next\/static\/"\)/);
    // Pages come from the network; only the offline page is precached.
    expect(sw).toMatch(/cache\.addAll\(\[OFFLINE\]\)/);
    expect(sw).not.toMatch(/\/api\//);
  });
});
