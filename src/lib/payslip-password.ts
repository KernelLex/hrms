/**
 * The password on an emailed payslip, and how the email explains it.
 *
 * The first four letters of the first name in capitals, then the day and
 * month of birth: ARJU2108 for Arjun, born on 21 August. It is a common
 * Indian payroll convention, so people recognise it. Without a date of
 * birth on record, it is the employee number.
 *
 * The plan was a PAN-based password, but the HRMS does not hold PANs yet;
 * phase 21 may switch to it once it does.
 */

export function payslipPassword(p: { firstName: string | null; dateOfBirth: string | null; employeeNumber: string }): string {
  const letters = (p.firstName ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
  if (!letters || !p.dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth)) return p.employeeNumber.toUpperCase();
  return `${letters}${p.dateOfBirth.slice(8, 10)}${p.dateOfBirth.slice(5, 7)}`;
}

/** The sentence that tells someone how to open it, without saying what it is. */
export function payslipPasswordHint(p: { firstName: string | null; dateOfBirth: string | null }): string {
  const letters = (p.firstName ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters || !p.dateOfBirth) return "It opens with your employee number in capitals.";
  return letters.length >= 4
    ? "It opens with the first four letters of your first name in capitals, then the day and month you were born: ARJU2108 for Arjun, born on 21 August."
    : "It opens with your first name in capitals, then the day and month you were born: RAM2108 for Ram, born on 21 August.";
}
