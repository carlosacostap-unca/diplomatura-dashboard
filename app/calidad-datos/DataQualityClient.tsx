"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  DashboardData,
  StudentModuleRecord,
} from "@/lib/diplomatura-data";
import {
  buildDashboardAnalytics,
  type DataQualityIssue,
  type DataQualityIssueKind,
} from "../dashboard-analytics";

type IssueStatus = "pending" | "reviewed" | "resolved";
type StatusFilter = "all" | IssueStatus;
type KindFilter = "all" | DataQualityIssueKind;

const ISSUE_STORAGE_KEY = "diplomatura-dashboard-issues-v1";
const NOTES_STORAGE_KEY = "diplomatura-dashboard-issue-notes-v1";

export default function DataQualityClient({ data }: { data: DashboardData }) {
  const issues = useMemo(
    () => buildDashboardAnalytics(data, "all").issues,
    [data],
  );
  const recordsByStudent = useMemo(() => {
    const records = new Map<string, StudentModuleRecord[]>();
    for (const record of data.records) {
      const current = records.get(record.studentId) ?? [];
      current.push(record);
      records.set(record.studentId, current);
    }
    return records;
  }, [data.records]);

  const [statuses, setStatuses] = useState<Record<string, IssueStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [cohortFilter, setCohortFilter] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [selectedIssueId, setSelectedIssueId] = useState(issues[0]?.id ?? "");
  const [hydrated, setHydrated] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  useEffect(() => {
    try {
      const savedStatuses = localStorage.getItem(ISSUE_STORAGE_KEY);
      const savedNotes = localStorage.getItem(NOTES_STORAGE_KEY);
      const nextStatuses = savedStatuses
        ? (JSON.parse(savedStatuses) as Record<string, IssueStatus>)
        : {};
      const nextNotes = savedNotes
        ? (JSON.parse(savedNotes) as Record<string, string>)
        : {};

      queueMicrotask(() => {
        setStatuses(nextStatuses);
        setNotes(nextNotes);
        setHydrated(true);
      });
    } catch {
      localStorage.removeItem(ISSUE_STORAGE_KEY);
      localStorage.removeItem(NOTES_STORAGE_KEY);
      queueMicrotask(() => setHydrated(true));
    }
  }, []);

  const filteredIssues = useMemo(() => {
    const query = normalizeSearch(search);

    return issues.filter((issue) => {
      const status = statuses[issue.id] ?? "pending";
      const records = recordsByStudent.get(issue.studentId) ?? [];
      const matchesSearch =
        !query ||
        normalizeSearch(
          `${issue.studentName} ${issue.title} ${issue.detail} ${records
            .map(
              (record) =>
                `${record.dni} ${record.email} ${record.phone} ${record.sourceFile}`,
            )
            .join(" ")}`,
        ).includes(query);
      const matchesStatus =
        statusFilter === "all" || status === statusFilter;
      const matchesKind = kindFilter === "all" || issue.kind === kindFilter;
      const matchesCohort =
        cohortFilter === "all" || issue.cohort === Number(cohortFilter);
      const matchesModule =
        moduleFilter === "all" || issue.module === Number(moduleFilter);

      return (
        matchesSearch &&
        matchesStatus &&
        matchesKind &&
        matchesCohort &&
        matchesModule
      );
    });
  }, [
    cohortFilter,
    issues,
    kindFilter,
    moduleFilter,
    recordsByStudent,
    search,
    statusFilter,
    statuses,
  ]);

  const selectedIssue =
    filteredIssues.find((issue) => issue.id === selectedIssueId) ??
    filteredIssues[0] ??
    null;
  const selectedRecords = selectedIssue
    ? (recordsByStudent.get(selectedIssue.studentId) ?? [])
    : [];
  const selectedStudent = selectedRecords[0];

  const statusCounts = useMemo(
    () => ({
      pending: issues.filter(
        (issue) => (statuses[issue.id] ?? "pending") === "pending",
      ).length,
      reviewed: issues.filter(
        (issue) => (statuses[issue.id] ?? "pending") === "reviewed",
      ).length,
      resolved: issues.filter(
        (issue) => (statuses[issue.id] ?? "pending") === "resolved",
      ).length,
    }),
    [issues, statuses],
  );
  const affectedStudents = new Set(issues.map((issue) => issue.studentId)).size;

  function updateStatus(issueId: string, status: IssueStatus) {
    setStatuses((current) => {
      const next = { ...current, [issueId]: status };
      localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function updateNote(issueId: string, note: string) {
    setNotes((current) => {
      const next = { ...current, [issueId]: note };
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setKindFilter("all");
    setCohortFilter("all");
    setModuleFilter("all");
  }

  function exportIssues() {
    const rows = filteredIssues.map((issue) => {
      const records = recordsByStudent.get(issue.studentId) ?? [];
      const student = records[0];
      return [
        issue.studentName,
        student?.dni ?? "",
        issueLabel(issue.kind),
        issue.cohort ?? "",
        issue.module ?? "",
        statusLabel(statuses[issue.id] ?? "pending"),
        records.map((record) => record.sourceFile).join(" | "),
        notes[issue.id] ?? "",
      ];
    });
    const headers = [
      "Estudiante",
      "DNI",
      "Problema",
      "Cohorte",
      "Modulo",
      "Estado",
      "Fuentes",
      "Nota",
    ];
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `calidad-datos-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyIssueSummary(issue: DataQualityIssue) {
    const records = recordsByStudent.get(issue.studentId) ?? [];
    const student = records[0];
    const summary = [
      `Estudiante: ${issue.studentName}`,
      `DNI: ${student?.dni || "Sin dato"}`,
      `Problema: ${issue.title}`,
      `Contexto: ${issue.detail}`,
      `Fuentes: ${Array.from(
        new Set(records.map((record) => record.sourceFile)),
      ).join(", ")}`,
      `Nota: ${notes[issue.id] || "Sin nota"}`,
    ].join("\n");
    await navigator.clipboard.writeText(summary);
    setCopyFeedback(true);
    window.setTimeout(() => setCopyFeedback(false), 1800);
  }

  return (
    <main className="min-h-screen bg-[#0f1115] text-[#f4f1ea]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-[#2d333b] pb-6">
          <nav
            className="mb-7 flex flex-wrap items-center gap-2 text-sm"
            aria-label="Navegación principal"
          >
            <Link href="/" className={navLinkClass}>Dashboard</Link>
            <Link href="/estudiantes" className={navLinkClass}>Estudiantes</Link>
            <span className="rounded-md bg-[#143c36] px-3 py-2 font-semibold text-[#9ff0db]">
              Calidad de datos
            </span>
          </nav>

          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase text-[#5ee0c1]">
                Centro de revisión
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-[#fbf7ef] sm:text-4xl">
                Calidad de datos
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-[#aab4c0]">
                Analizá cada inconsistencia, verificá su fuente y documentá la
                corrección realizada sobre los registros académicos.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Problemas" value={issues.length} />
              <Metric label="Estudiantes" value={affectedStudents} />
              <Metric label="Pendientes" value={statusCounts.pending} tone="amber" />
              <Metric label="Resueltos" value={statusCounts.resolved} tone="teal" />
            </div>
          </div>
        </header>

        <section className="grid gap-4 rounded-lg border border-[#303741] bg-[#181c22] p-4 md:grid-cols-2 xl:grid-cols-[1.3fr_repeat(4,minmax(145px,0.65fr))_auto] xl:items-end">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#b7c0cb]">Buscar</span>
            <input
              className={inputClass}
              placeholder="Nombre, DNI, correo, teléfono o fuente"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <FilterSelect
            label="Estado"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={[
              { value: "pending", label: "Pendiente" },
              { value: "reviewed", label: "Revisada" },
              { value: "resolved", label: "Resuelta" },
            ]}
          />
          <FilterSelect
            label="Problema"
            value={kindFilter}
            onChange={(value) => setKindFilter(value as KindFilter)}
            options={issueKindOptions}
          />
          <FilterSelect
            label="Cohorte"
            value={cohortFilter}
            onChange={setCohortFilter}
            options={data.cohorts.map((cohort) => ({
              value: String(cohort),
              label: `Cohorte ${cohort}`,
            }))}
          />
          <FilterSelect
            label="Módulo"
            value={moduleFilter}
            onChange={setModuleFilter}
            options={data.modules.map((moduleItem) => ({
              value: String(moduleItem.id),
              label: `Módulo ${moduleItem.id}`,
            }))}
          />
          <button type="button" className={secondaryButtonClass} onClick={clearFilters}>
            Limpiar
          </button>
        </section>

        <section className="grid min-w-0 gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="min-w-0 overflow-hidden rounded-lg border border-[#303741] bg-[#181c22]">
            <div className="flex items-center justify-between border-b border-[#303741] px-4 py-4">
              <div>
                <h2 className="font-semibold text-[#fbf7ef]">Bandeja</h2>
                <p className="text-sm text-[#aab4c0]">
                  {filteredIssues.length} inconsistencias
                </p>
              </div>
              <button
                type="button"
                className="h-9 rounded-md border border-[#3b4652] px-3 text-xs font-semibold text-[#a9d8ff] transition hover:border-[#76bfff] hover:bg-[#1d3040] disabled:opacity-40"
                disabled={filteredIssues.length === 0}
                onClick={exportIssues}
              >
                Exportar CSV
              </button>
            </div>
            <div className="max-h-[780px] divide-y divide-[#303741] overflow-y-auto">
              {filteredIssues.map((issue) => {
                const status = statuses[issue.id] ?? "pending";
                const active = selectedIssue?.id === issue.id;
                return (
                  <button
                    key={issue.id}
                    type="button"
                    className={`w-full px-4 py-4 text-left transition ${
                      active
                        ? "bg-[#1d3040]"
                        : "bg-[#181c22] hover:bg-[#20262e]"
                    }`}
                    onClick={() => setSelectedIssueId(issue.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[#fbf7ef]">
                          {issue.studentName}
                        </span>
                        <span className="mt-1 block text-sm text-[#dfe5eb]">
                          {issue.title}
                        </span>
                      </span>
                      <StatusDot status={status} />
                    </div>
                    <span className="mt-2 block text-xs text-[#7e8793]">
                      {issue.detail}
                    </span>
                  </button>
                );
              })}
              {filteredIssues.length === 0 && (
                <p className="px-5 py-12 text-center text-sm text-[#aab4c0]">
                  No hay inconsistencias para estos filtros.
                </p>
              )}
            </div>
          </div>

          <div className="min-w-0">
            {selectedIssue && selectedStudent ? (
              <IssueWorkspace
                issue={selectedIssue}
                student={selectedStudent}
                records={selectedRecords}
                status={statuses[selectedIssue.id] ?? "pending"}
                note={notes[selectedIssue.id] ?? ""}
                hydrated={hydrated}
                copyFeedback={copyFeedback}
                onStatusChange={(status) => updateStatus(selectedIssue.id, status)}
                onNoteChange={(note) => updateNote(selectedIssue.id, note)}
                onCopy={() => copyIssueSummary(selectedIssue)}
              />
            ) : (
              <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-[#3b4652] px-6 text-center text-[#aab4c0]">
                Seleccioná una inconsistencia para analizarla.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function IssueWorkspace({
  issue,
  student,
  records,
  status,
  note,
  hydrated,
  copyFeedback,
  onStatusChange,
  onNoteChange,
  onCopy,
}: {
  issue: DataQualityIssue;
  student: StudentModuleRecord;
  records: StudentModuleRecord[];
  status: IssueStatus;
  note: string;
  hydrated: boolean;
  copyFeedback: boolean;
  onStatusChange: (status: IssueStatus) => void;
  onNoteChange: (note: string) => void;
  onCopy: () => void;
}) {
  const relatedRecords =
    issue.cohort && issue.module
      ? records.filter(
          (record) =>
            record.cohort === issue.cohort && record.module === issue.module,
        )
      : records;
  const sources = Array.from(
    new Set(relatedRecords.map((record) => record.sourceFile).filter(Boolean)),
  );
  const guidance = resolutionGuidance(issue.kind);

  return (
    <article className="overflow-hidden rounded-lg border border-[#303741] bg-[#181c22]">
      <header className="border-b border-[#303741] px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-[#5ee0c1]">
              {issueLabel(issue.kind)}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[#fbf7ef]">
              {issue.studentName}
            </h2>
            <p className="mt-1 text-sm text-[#aab4c0]">{issue.detail}</p>
          </div>
          <Link
            href={`/estudiantes/${issue.studentId}`}
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-[#3b4652] px-3 text-sm font-semibold text-[#5ee0c1] transition hover:border-[#5ee0c1] hover:bg-[#143c36]"
          >
            Abrir ficha
          </Link>
        </div>

        <div className="mt-5" role="group" aria-label="Estado de la revisión">
          <p className="mb-2 text-xs font-semibold uppercase text-[#7e8793]">
            Estado
          </p>
          <div className="inline-flex rounded-md border border-[#3b4652] bg-[#10141a] p-1">
            {(["pending", "reviewed", "resolved"] as IssueStatus[]).map(
              (option) => (
                <button
                  key={option}
                  type="button"
                  className={`h-9 px-3 text-xs font-semibold transition ${
                    status === option
                      ? statusActiveClass(option)
                      : "text-[#aab4c0] hover:text-[#fbf7ef]"
                  }`}
                  onClick={() => onStatusChange(option)}
                >
                  {statusLabel(option)}
                </button>
              ),
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-0 xl:grid-cols-[1fr_300px]">
        <div className="space-y-6 p-5 xl:border-r xl:border-[#303741]">
          <section>
            <h3 className="font-semibold text-[#fbf7ef]">Diagnóstico</h3>
            <p className="mt-2 text-sm leading-6 text-[#dfe5eb]">
              {guidance.diagnosis}
            </p>
            <div className="mt-4 border-l-4 border-[#4ba3df] bg-[#1d3040] px-4 py-3">
              <p className="text-xs font-semibold uppercase text-[#a9d8ff]">
                Acción sugerida
              </p>
              <p className="mt-1 text-sm leading-6 text-[#d9efff]">
                {guidance.action}
              </p>
            </div>
          </section>

          <section>
            <h3 className="font-semibold text-[#fbf7ef]">Registros involucrados</h3>
            <div className="mt-3 overflow-x-auto rounded-md border border-[#303741]">
              <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                <thead className="bg-[#13171d] text-xs uppercase text-[#b7c0cb]">
                  <tr>
                    <TableHead>Cohorte</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Inscripción</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Fuente</TableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#303741]">
                  {relatedRecords.map((record) => (
                    <tr key={record.id} className="text-[#dfe5eb]">
                      <td className="px-3 py-3">Cohorte {record.cohort}</td>
                      <td className="px-3 py-3">M{record.module}</td>
                      <td className="px-3 py-3">
                        {record.enrollmentKnown
                          ? enrollmentTypeLabel(record.enrollmentType)
                          : "Sin registro"}
                      </td>
                      <td className="px-3 py-3">
                        {record.approved ? "Aprobó" : "No aprobó"}
                      </td>
                      <td className="max-w-64 break-words px-3 py-3 text-xs text-[#aab4c0]">
                        {record.sourceFile || "Sin fuente"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <label className="block">
              <span className="font-semibold text-[#fbf7ef]">Nota de revisión</span>
              <span className="mt-1 block text-xs text-[#7e8793]">
                Documentá qué verificaste y dónde realizaste la corrección.
              </span>
              <textarea
                className="mt-3 min-h-32 w-full resize-y rounded-md border border-[#3b4652] bg-[#10141a] px-3 py-3 text-sm leading-6 text-[#f4f1ea] outline-none placeholder:text-[#687382] focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20 disabled:opacity-50"
                placeholder="Ejemplo: DNI verificado en la planilla original y actualizado en PocketBase."
                value={note}
                disabled={!hydrated}
                onChange={(event) => onNoteChange(event.target.value)}
              />
            </label>
            <div className="mt-3 flex justify-end">
              <button type="button" className={secondaryButtonClass} onClick={onCopy}>
                {copyFeedback ? "Resumen copiado" : "Copiar resumen"}
              </button>
            </div>
          </section>
        </div>

        <aside className="space-y-6 bg-[#13171d] p-5">
          <section>
            <h3 className="font-semibold text-[#fbf7ef]">Datos actuales</h3>
            <dl className="mt-3 divide-y divide-[#303741]">
              <DataField label="DNI" value={student.dni ? formatDni(student.dni) : "Sin dato"} missing={!student.dni} />
              <DataField label="Correo" value={student.email || "Sin dato"} missing={!student.email} />
              <DataField label="Teléfono" value={student.phone || "Sin dato"} missing={!student.phone} />
              <DataField label="Género" value={student.gender || "Sin dato"} missing={!student.gender} />
            </dl>
          </section>
          <section>
            <h3 className="font-semibold text-[#fbf7ef]">Fuentes a revisar</h3>
            <div className="mt-3 space-y-2">
              {sources.map((source) => (
                <p key={source} className="break-words rounded-md border border-[#303741] bg-[#181c22] px-3 py-2 text-xs leading-5 text-[#b7c0cb]">
                  {source}
                </p>
              ))}
              {sources.length === 0 && <p className="text-sm text-[#7e8793]">Sin archivo fuente registrado.</p>}
            </div>
          </section>
          <p className="border-t border-[#303741] pt-4 text-xs leading-5 text-[#7e8793]">
            Los estados y notas de esta revisión se guardan en este navegador.
            Los datos académicos continúan leyéndose desde PocketBase.
          </p>
        </aside>
      </div>
    </article>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "amber" | "teal" }) {
  const border = tone === "amber" ? "border-[#705a2c]" : tone === "teal" ? "border-[#276b60]" : "border-[#303741]";
  return <div className={`min-w-28 rounded-lg border bg-[#181c22] p-3 ${border}`}><p className="text-[11px] font-semibold uppercase text-[#aab4c0]">{label}</p><p className="mt-1 text-2xl font-semibold text-[#fbf7ef]">{value}</p></div>;
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="flex flex-col gap-2"><span className="text-sm font-medium text-[#b7c0cb]">{label}</span><select className={inputClass} value={value} onChange={(event) => onChange(event.target.value)}><option value="all">Todos</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function StatusDot({ status }: { status: IssueStatus }) {
  const color = status === "resolved" ? "bg-[#5ee0c1]" : status === "reviewed" ? "bg-[#4ba3df]" : "bg-[#d8a13f]";
  return <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${color}`} title={statusLabel(status)} />;
}

function DataField({ label, value, missing = false }: { label: string; value: string; missing?: boolean }) {
  return <div className="py-3"><dt className="text-xs uppercase text-[#7e8793]">{label}</dt><dd className={`mt-1 break-words text-sm font-medium ${missing ? "text-[#ffb4ad]" : "text-[#dfe5eb]"}`}>{value}</dd></div>;
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

function resolutionGuidance(kind: DataQualityIssueKind): { diagnosis: string; action: string } {
  return {
    "missing-dni": {
      diagnosis: "El estudiante no tiene un DNI asociado. Esto dificulta conciliarlo con nuevas planillas y distinguir homónimos.",
      action: "Verificar el DNI en la fuente original o documentación institucional y completar el primer registro del estudiante en PocketBase.",
    },
    "missing-email": {
      diagnosis: "El correo del estudiante está vacío. El dato no impide seguir su trayectoria, pero limita el contacto y algunas conciliaciones.",
      action: "Buscar el correo en las planillas de inscripción y completar el registro del estudiante. No se considera error que dos personas compartan correo.",
    },
    "missing-phone": {
      diagnosis: "El teléfono del estudiante está vacío en el registro consolidado.",
      action: "Contrastar las inscripciones de todas sus cohortes y completar el teléfono más antiguo que figure como válido.",
    },
    "unknown-enrollment": {
      diagnosis: "Existe una inscripción, pero todavía no está clasificada como alumno nuevo o recursante.",
      action: "Revisar su historial anterior. Si ya cursó el mismo módulo, clasificarlo como recursante; en caso contrario, como nuevo.",
    },
    "missing-enrollment": {
      diagnosis: "Existe una aprobación para este módulo, pero no se encontró una inscripción que la respalde en la base consolidada.",
      action: "Verificar la planilla de inscriptos de esa cohorte y módulo. Si corresponde, crear la inscripción relacionada sin eliminar la aprobación existente.",
    },
  }[kind];
}

function issueLabel(kind: DataQualityIssueKind): string {
  return {
    "missing-dni": "DNI faltante",
    "missing-email": "Correo faltante",
    "missing-phone": "Teléfono faltante",
    "unknown-enrollment": "Inscripción sin clasificar",
    "missing-enrollment": "Aprobación sin inscripción",
  }[kind];
}

function statusLabel(status: IssueStatus): string {
  return { pending: "Pendiente", reviewed: "Revisada", resolved: "Resuelta" }[status];
}

function statusActiveClass(status: IssueStatus): string {
  return status === "resolved" ? "rounded-sm bg-[#143c36] text-[#9ff0db]" : status === "reviewed" ? "rounded-sm bg-[#1d3040] text-[#a9d8ff]" : "rounded-sm bg-[#3d321d] text-[#ffd58a]";
}

function enrollmentTypeLabel(value: StudentModuleRecord["enrollmentType"]): string {
  return { new: "Nuevo", repeater: "Recursante", unknown: "Sin clasificar" }[value];
}

function formatDni(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function csvCell(value: string | number): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

const issueKindOptions = [
  { value: "missing-dni", label: "DNI faltante" },
  { value: "missing-email", label: "Correo faltante" },
  { value: "missing-phone", label: "Teléfono faltante" },
  { value: "unknown-enrollment", label: "Inscripción sin clasificar" },
  { value: "missing-enrollment", label: "Aprobación sin inscripción" },
];

const navLinkClass = "rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]";
const inputClass = "h-11 w-full rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-sm text-[#f4f1ea] outline-none transition placeholder:text-[#687382] focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20";
const secondaryButtonClass = "h-11 rounded-md border border-[#3b4652] px-4 text-sm font-medium text-[#5ee0c1] transition hover:border-[#5ee0c1] hover:bg-[#143c36]";
