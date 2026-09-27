/**
 * Text people typed into a long field, shown as they meant it: blank lines
 * start paragraphs, and a list field shows one item per line. Plain text
 * only — nothing typed is ever read as markup.
 */

export function Paragraphs({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null;
  return (
    <div className={className}>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className="mt-3 whitespace-pre-line first:mt-0">
            {p}
          </p>
        ))}
    </div>
  );
}

export function Lines({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null;
  const items = text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  return (
    <ul className={className ?? "list-disc space-y-1 pl-5"}>
      {items.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}
