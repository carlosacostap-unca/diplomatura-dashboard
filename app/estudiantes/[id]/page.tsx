import Link from "next/link";
import { notFound } from "next/navigation";
import { getStudentProfiles, modules } from "@/lib/diplomatura-data";

export const dynamic = "force-dynamic";

export default async function StudentDetailPage({
  params,
}: PageProps<"/estudiantes/[id]">) {
  const { id } = await params;
  const students = await getStudentProfiles();
  const student = students.find((item) => item.id === id);

  if (!student) {
    notFound();
  }

  const recordsByModule = new Map(
    student.academicRecords.map((record) => [record.module, record]),
  );

  return (
    <main className="min-h-screen bg-[#0f1115] text-[#f4f1ea]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <nav
          className="flex items-center gap-2 text-sm"
          aria-label="Navegación principal"
        >
          <Link
            href="/"
            className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
          >
            Dashboard
          </Link>
          <span className="text-[#55606d]">/</span>
          <Link
            href="/estudiantes"
            className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
          >
            Estudiantes
          </Link>
          <span className="text-[#55606d]">/</span>
          <Link
            href="/calidad-datos"
            className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
          >
            Calidad de datos
          </Link>
          <span className="hidden text-[#55606d] sm:inline">/</span>
          <span className="hidden truncate text-[#dfe5eb] sm:inline">
            {student.firstName} {student.lastName}
          </span>
        </nav>

        <header className="grid gap-6 border-b border-[#2d333b] pb-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-[#5ee0c1]">
              Historial académico
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[#fbf7ef] sm:text-4xl">
              {student.firstName} {student.lastName}
            </h1>
            <p className="mt-3 text-base text-[#aab4c0]">
              Trayectoria completa dentro de la Diplomatura en Desarrollo Web
              Full Stack con JavaScript.
            </p>
          </div>
          <div className="rounded-lg border border-[#5ee0c1]/50 bg-[#143c36] px-5 py-4">
            <p className="text-xs font-semibold uppercase text-[#9ff0db]/70">
              Progreso general
            </p>
            <p className="mt-1 text-3xl font-semibold text-[#d9fff5]">
              {student.approvedModules.length}/4
            </p>
            <p className="text-sm text-[#9ff0db]">módulos aprobados</p>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <aside className="h-fit rounded-lg border border-[#303741] bg-[#181c22] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)]">
            <h2 className="text-lg font-semibold text-[#fbf7ef]">
              Datos personales
            </h2>
            <dl className="mt-5 divide-y divide-[#303741]">
              <PersonalData
                label="DNI"
                value={student.dni ? formatDni(student.dni) : "Sin dato"}
              />
              <PersonalData
                label="Fecha de nacimiento"
                value={formatDate(student.birthDate)}
              />
              <PersonalData
                label="Género"
                value={student.gender || "Sin dato"}
              />
              <PersonalData
                label="Teléfono"
                value={student.phone || "Sin dato"}
                href={student.phone ? `tel:${student.phone}` : undefined}
              />
              <PersonalData
                label="Email"
                value={student.email || "Sin dato"}
                href={student.email ? `mailto:${student.email}` : undefined}
              />
              <PersonalData
                label="Cohorte"
                value={student.cohorts
                  .map((cohort) => `Cohorte ${cohort}`)
                  .join(", ")}
              />
            </dl>
          </aside>

          <div className="space-y-6">
            <section className="rounded-lg border border-[#303741] bg-[#181c22] p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-[#fbf7ef]">
                    Recorrido por módulos
                  </h2>
                  <p className="mt-1 text-sm text-[#aab4c0]">
                    Estado consolidado de los cuatro módulos de la diplomatura.
                  </p>
                </div>
                <p className="text-sm text-[#7e8793]">
                  {student.academicRecords.length} registros académicos
                </p>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {modules.map((moduleItem) => {
                  const record = recordsByModule.get(moduleItem.id);
                  const approved = student.approvedModules.includes(
                    moduleItem.id,
                  );

                  return (
                    <article
                      key={moduleItem.id}
                      className={`rounded-lg border p-4 ${
                        approved
                          ? "border-[#2b7667] bg-[#123a36]"
                          : record
                            ? "border-[#5e4c2c] bg-[#2b261b]"
                            : "border-[#303741] bg-[#13171d]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-xs font-semibold uppercase text-[#aab4c0]">
                          Módulo {moduleItem.id}
                        </span>
                        <StatusBadge
                          approved={approved}
                          hasRecord={Boolean(record)}
                        />
                      </div>
                      <h3 className="mt-3 font-semibold text-[#fbf7ef]">
                        {moduleItem.name}
                      </h3>
                      <p className="mt-2 text-sm text-[#aab4c0]">
                        {record
                          ? `Cohorte ${record.cohort}${
                              record.enrollmentType === "repeater"
                                ? " · Recursante"
                                : record.enrollmentType === "new"
                                  ? " · Nuevo"
                                  : ""
                            }`
                          : "Sin registro académico"}
                      </p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-[#303741] bg-[#181c22]">
              <div className="border-b border-[#303741] px-5 py-4">
                <h2 className="text-lg font-semibold text-[#fbf7ef]">
                  Cronología académica
                </h2>
                <p className="mt-1 text-sm text-[#aab4c0]">
                  Detalle de inscripción y aprobación por cohorte.
                </p>
              </div>
              <div className="divide-y divide-[#303741]">
                {student.academicRecords.map((record) => (
                  <div
                    key={record.id}
                    className="grid gap-3 px-5 py-4 sm:grid-cols-[90px_1fr_auto] sm:items-center"
                  >
                    <div>
                      <p className="text-xs font-semibold uppercase text-[#7e8793]">
                        Cohorte
                      </p>
                      <p className="mt-1 text-xl font-semibold text-[#fbf7ef]">
                        {record.cohort}
                      </p>
                    </div>
                    <div>
                      <p className="font-semibold text-[#dfe5eb]">
                        Módulo {record.module}: {record.moduleName}
                      </p>
                      <p className="mt-1 text-sm text-[#aab4c0]">
                        {academicRecordDescription(record)}
                      </p>
                    </div>
                    <StatusBadge approved={record.approved} hasRecord />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function PersonalData({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="py-3">
      <dt className="text-xs font-semibold uppercase text-[#7e8793]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-[#dfe5eb]">
        {href ? (
          <a className="text-[#5ee0c1] hover:underline" href={href}>
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function StatusBadge({
  approved,
  hasRecord,
}: {
  approved: boolean;
  hasRecord: boolean;
}) {
  const label = approved
    ? "Aprobado"
    : hasRecord
      ? "Sin aprobación"
      : "Sin cursada";
  const className = approved
    ? "bg-[#1f5b4f] text-[#baf7e7]"
    : hasRecord
      ? "bg-[#55451f] text-[#ffdc92]"
      : "bg-[#20262e] text-[#aab4c0]";

  return (
    <span
      className={`inline-flex h-8 w-fit items-center rounded-full px-3 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

function academicRecordDescription(
  record: Awaited<ReturnType<typeof getStudentProfiles>>[number]["academicRecords"][number],
): string {
  if (!record.enrollmentKnown) {
    return "Aprobación registrada sin dato de inscripción";
  }
  if (record.enrollmentType === "repeater") {
    return "Inscripción como recursante";
  }
  if (record.enrollmentType === "new") {
    return "Inscripción como estudiante nuevo";
  }
  return "Inscripción registrada";
}

function formatDni(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatDate(value: string): string {
  if (!value) {
    return "Sin dato";
  }

  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-AR").format(date);
}
