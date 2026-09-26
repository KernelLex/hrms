import fs from "node:fs";

/**
 * Loads .env.local then .env for standalone scripts.
 *
 * Next.js does this itself at runtime, but `tsx` does not, so the migrate and
 * seed scripts call it explicitly. Uses Node's built-in loader; values already
 * present in the environment win, which is what CI and Vercel need.
 */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      // Older Node, or a malformed file — fall back to a minimal parse.
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
        if (!m) continue;
        const key = m[1];
        if (process.env[key] !== undefined) continue;
        process.env[key] = (m[2] ?? "").replace(/^['"]|['"]$/g, "");
      }
    }
  }
}
