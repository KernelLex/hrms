import type { Client } from "@libsql/client";

/**
 * The active onboarding checklist template every hire starts from, and one
 * letter template HR can issue straightaway. Idempotent: each is only
 * inserted the first time, by its natural key (`event`, and `kind` +
 * `version`), the same way the seed treats every other reference table.
 */
export async function seedLifecycle(client: Client): Promise<string[]> {
  const notes: string[] = [];
  const at = new Date().toISOString();

  const template = await client.execute("SELECT 1 FROM pa_checklist_template WHERE event = 'onboarding' LIMIT 1");
  if (template.rows.length === 0) {
    const created = await client.execute({
      sql: "INSERT INTO pa_checklist_template (event, name, is_active, created_at) VALUES ('onboarding', ?, 1, ?) RETURNING id",
      args: ["Standard onboarding", at],
    });
    const templateId = Number(created.rows[0].id);
    const items: [string, string, number, number][] = [
      ["Set up their laptop and system accounts", "hr", 1, 10],
      ["Collect their signed offer and ID documents", "hr", 7, 20],
      ["Introduce them to the team", "reporting_manager", 1, 30],
      ["Complete the induction briefing", "hr", 3, 40],
      ["Agree their first 30 days' goals", "reporting_manager", 30, 50],
    ];
    await client.batch(
      items.map(([task, ownerType, dueDays, sortOrder]) => ({
        sql: "INSERT INTO pa_checklist_item (template_id, task, owner_type, due_days, sort_order) VALUES (?, ?, ?, ?, ?)",
        args: [templateId, task, ownerType, dueDays, sortOrder],
      })),
      "write",
    );
    notes.push("  1 onboarding checklist template, 5 tasks");
  }

  const letter = await client.execute("SELECT 1 FROM pa_letter_template WHERE kind = 'Appointment' LIMIT 1");
  if (letter.rows.length === 0) {
    const body = [
      "Dear {{first_name}} {{last_name}},",
      "We are pleased to confirm your appointment as {{position_title}} in {{department}} at {{company_name}}, with effect from {{effective_date}}.",
      "Your monthly basic pay will be {{basic_pay}}, under pay scale group {{pay_scale_group}}. This letter forms part of your employment record.",
      "We look forward to your contribution.",
      "Yours sincerely,\n{{company_name}}\n{{company_address}}",
    ].join("\n\n");
    await client.execute({
      sql: "INSERT INTO pa_letter_template (kind, version, is_active, body, created_by, created_at) VALUES ('Appointment', 1, 1, ?, 'seed', ?)",
      args: [body, at],
    });
    notes.push("  1 letter template: Appointment");
  }

  return notes;
}
