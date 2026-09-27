import { PROBLEM_STATUS, PROBLEM_TYPES, type ProblemCode } from "@/lib/api/problem";

/**
 * What each API error code means: the page every problem document's `type`
 * links to, one anchor per code. Public, like the reference beside it.
 */
export const dynamic = "force-static";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const rows = (Object.keys(PROBLEM_TYPES) as ProblemCode[])
  .map(
    (code) => `      <tr id="${code}">
        <td><code>${code}</code></td>
        <td class="num">${PROBLEM_STATUS[code]}</td>
        <td>${escape(PROBLEM_TYPES[code])}</td>
      </tr>`,
  )
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HRMS API errors</title>
    <meta name="description" content="What each error code of the HRMS API means." />
    <style>
      :root { --bg: #fafaf9; --card: #ffffff; --ink: #1c1917; --muted: #57534e; --line: #e7e5e4; --mark: #fef3c7; }
      @media (prefers-color-scheme: dark) {
        :root { --bg: #0c0a09; --card: #1c1917; --ink: #f5f5f4; --muted: #a8a29e; --line: #292524; --mark: #422006; }
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { max-width: 860px; margin: 0 auto; padding: 48px 16px; }
      h1 { font-size: 24px; letter-spacing: -0.01em; margin: 0 0 8px; }
      p { color: var(--muted); margin: 0 0 24px; }
      a { color: inherit; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--line); vertical-align: top; }
      tr:last-child td { border-bottom: 0; }
      th { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      code { font: 13px/1.4 ui-monospace, "Cascadia Mono", Menlo, monospace; overflow-wrap: anywhere; }
      .card:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
      tr:target { background: var(--mark); }
    </style>
  </head>
  <body>
    <main>
      <h1>API errors</h1>
      <p>Every error is an RFC 9457 problem document with one of these codes. Switch on <code>code</code>; the wording may change. The guide and the <a href="/developers">API reference</a> explain what to do about each.</p>
      <div class="card" role="region" aria-label="Error codes" tabindex="0">
        <table>
          <thead><tr><th>Code</th><th class="num">Status</th><th>Means</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </div>
    </main>
  </body>
</html>`;

export function GET(): Response {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
