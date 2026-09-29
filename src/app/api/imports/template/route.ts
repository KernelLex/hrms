import { requirePage } from "@/lib/access";
import { csvResponse } from "@/lib/csv";
import { isImportKind, templateFor } from "@/lib/services/imports";

/** The blank spreadsheet for one import kind: its header row and an example. */
export async function GET(request: Request) {
  await requirePage(["org.view"], "/");
  const kind = new URL(request.url).searchParams.get("kind");
  if (!isImportKind(kind)) return new Response("Choose a kind of import.", { status: 400 });
  return csvResponse(templateFor(kind), `${kind}-template.csv`);
}
