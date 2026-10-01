import { requirePage } from "@/lib/access";
import { listCourses, listSessions } from "@/lib/repositories/training";
import { saveCourse, deleteCourse, saveSession, deleteSession } from "@/app/actions/training";
import { MasterScreen, type Column, type FieldDef } from "@/components/master-screen";
import { PageHeader, TwoLine } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatINR, toRupees } from "@/lib/money";
import { TrainingTabs } from "../tabs";

const COURSE_COLUMNS: Column[] = [
  { key: "code", label: "Code" },
  { key: "title", label: "Title" },
  { key: "cost", label: "Cost", numeric: true },
  { key: "sessions", label: "Sessions", numeric: true },
  { key: "active", label: "Active" },
];

const SESSION_COLUMNS: Column[] = [
  { key: "course", label: "Course" },
  { key: "dates", label: "Dates" },
  { key: "place", label: "Place" },
  { key: "capacity", label: "Seats" },
  { key: "cost", label: "Cost", numeric: true },
];

/** The courses offered, and the sessions scheduled for them. */
export default async function CataloguePage() {
  await requirePage(["training.manage"], "/training/my-training");

  const [courses, sessions] = await Promise.all([listCourses(), listSessions()]);

  const courseFields: FieldDef[] = [
    { kind: "text", name: "code", label: "Code", required: true, placeholder: "FORKLIFT-1" },
    { kind: "text", name: "title", label: "Title", required: true, full: true },
    { kind: "text", name: "description", label: "Description", full: true },
    { kind: "text", name: "cost", label: "Cost (₹)", hint: "What one seat costs, by default." },
    { kind: "checkbox", name: "isActive", label: "Active" },
  ];

  const sessionFields: FieldDef[] = [
    { kind: "select", name: "courseCode", label: "Course", required: true, options: courses.map((c) => ({ value: c.code, label: `${c.code} — ${c.title}` })) },
    { kind: "date", name: "startDate", label: "Start date", required: true },
    { kind: "date", name: "endDate", label: "End date", required: true },
    { kind: "text", name: "capacity", label: "Seats", required: true, placeholder: "20" },
    { kind: "text", name: "place", label: "Place" },
    { kind: "text", name: "cost", label: "Cost (₹)", hint: "Leave blank to use the course's own cost." },
  ];

  return (
    <>
      <TrainingTabs />
      <PageHeader title="Training catalogue" subtitle="Courses, and the sessions scheduled for them." />

      <MasterScreen
        title="Courses"
        subtitle="What is on offer."
        entity="course"
        columns={COURSE_COLUMNS}
        idField="code"
        fields={courseFields}
        saveAction={saveCourse}
        deleteAction={deleteCourse}
        emptyHint="Add a course to get started."
        rows={courses.map((c) => ({
          id: c.code,
          describe: c.title,
          cells: {
            code: <span className="font-medium text-ink">{c.code}</span>,
            title: c.title,
            cost: formatINR(c.costPaise),
            sessions: c.sessionCount,
            active: c.isActive ? "Yes" : "No",
          },
          values: { code: c.code, originalCode: c.code, title: c.title, description: c.description ?? "", cost: String(toRupees(c.costPaise)), isActive: c.isActive ? "1" : "0" },
        }))}
      />

      <div className="mt-6">
        <MasterScreen
          title="Sessions"
          subtitle="A scheduled run of a course."
          entity="session"
          columns={SESSION_COLUMNS}
          idField="id"
          fields={sessionFields}
          saveAction={saveSession}
          deleteAction={deleteSession}
          emptyHint="Schedule a session for a course."
          rows={sessions.map((s) => ({
            id: String(s.id),
            describe: s.courseTitle,
            cells: {
              course: <TwoLine value={s.courseTitle} sub={s.courseCode} />,
              dates: `${formatDate(s.startDate)} – ${formatDate(s.endDate)}`,
              place: s.place ?? "—",
              capacity: `${s.approved}/${s.capacity}`,
              cost: formatINR(s.costPaise),
            },
            values: { id: String(s.id), courseCode: s.courseCode, startDate: s.startDate, endDate: s.endDate, capacity: String(s.capacity), place: s.place ?? "", cost: String(toRupees(s.costPaise)) },
          }))}
        />
      </div>
    </>
  );
}
