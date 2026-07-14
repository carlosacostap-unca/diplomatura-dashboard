"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { StudentProfile } from "@/lib/diplomatura-data";

type StudentsClientProps = {
  students: StudentProfile[];
};

export default function StudentsClient({ students }: StudentsClientProps) {
  const [search, setSearch] = useState("");
  const [selectedCohort, setSelectedCohort] = useState("all");
  const [selectedGender, setSelectedGender] = useState("all");

  const cohortOptions = useMemo(
    () =>
      Array.from(new Set(students.flatMap((student) => student.cohorts))).sort(
        (first, second) => first - second,
      ),
    [students],
  );
  const genderOptions = useMemo(
    () =>
      Array.from(
        new Set(students.map((student) => student.gender).filter(Boolean)),
      ).sort((first, second) => first.localeCompare(second, "es")),
    [students],
  );

  const filteredStudents = useMemo(() => {
    const searchValue = normalizeSearch(search);

    return students.filter((student) => {
      const matchesSearch =
        searchValue.length === 0 ||
        normalizeSearch(
          `${student.fullName} ${student.firstName} ${student.lastName} ${student.lastName} ${student.firstName} ${student.dni} ${student.email} ${student.phone}`,
        ).includes(searchValue);
      const matchesCohort =
        selectedCohort === "all" ||
        student.cohorts.some((cohort) => cohort === Number(selectedCohort));
      const matchesGender =
        selectedGender === "all" || student.gender === selectedGender;

      return matchesSearch && matchesCohort && matchesGender;
    });
  }, [search, selectedCohort, selectedGender, students]);

  const withCompleteContact = students.filter(
    (student) => student.email && student.phone,
  ).length;
  const graduates = students.filter(
    (student) => student.approvedModules.length === 4,
  ).length;

  return (
    <main className="min-h-screen bg-[#0f1115] text-[#f4f1ea]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-6 sm:px-6 lg:px-8">
        <header className="border-b border-[#2d333b] pb-6">
          <nav
            className="mb-7 flex items-center gap-2 text-sm"
            aria-label="Navegación principal"
          >
            <Link
              href="/"
              className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
            >
              Dashboard
            </Link>
            <span className="rounded-md bg-[#143c36] px-3 py-2 font-semibold text-[#9ff0db]">
              Estudiantes
            </span>
            <Link
              href="/calidad-datos"
              className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
            >
              Calidad de datos
            </Link>
          </nav>

          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-[#5ee0c1]">
                Gestión académica
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-[#fbf7ef] sm:text-4xl">
                Estudiantes
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[#aab4c0]">
                Padrón único de la diplomatura. Seleccioná una persona para ver
                sus datos y el recorrido completo por módulos y cohortes.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Metric label="Total" value={students.length} />
              <Metric label="Contacto completo" value={withCompleteContact} />
              <Metric label="4 módulos" value={graduates} />
            </div>
          </div>
        </header>

        <section className="grid gap-4 rounded-lg border border-[#303741] bg-[#181c22] p-4 md:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.5fr)_minmax(180px,0.5fr)_auto] md:items-end">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#b7c0cb]">
              Buscar estudiante
            </span>
            <input
              className="h-11 rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-sm text-[#f4f1ea] outline-none transition placeholder:text-[#687382] focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20"
              placeholder="Nombre, DNI, email o teléfono"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <FilterSelect
            label="Cohorte"
            value={selectedCohort}
            onChange={setSelectedCohort}
            options={cohortOptions.map((cohort) => ({
              value: String(cohort),
              label: `Cohorte ${cohort}`,
            }))}
          />
          <FilterSelect
            label="Género"
            value={selectedGender}
            onChange={setSelectedGender}
            options={genderOptions.map((gender) => ({
              value: gender,
              label: gender,
            }))}
          />

          <button
            type="button"
            className="h-11 rounded-md border border-[#3b4652] px-4 text-sm font-medium text-[#5ee0c1] transition hover:border-[#5ee0c1] hover:bg-[#143c36]"
            onClick={() => {
              setSearch("");
              setSelectedCohort("all");
              setSelectedGender("all");
            }}
          >
            Limpiar
          </button>
        </section>

        <section className="overflow-hidden rounded-lg border border-[#303741] bg-[#181c22] shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
          <div className="flex items-center justify-between border-b border-[#303741] px-4 py-4">
            <div>
              <h2 className="text-lg font-semibold text-[#fbf7ef]">
                Padrón general
              </h2>
              <p className="text-sm text-[#aab4c0]">
                {filteredStudents.length} de {students.length} estudiantes
              </p>
            </div>
            <p className="hidden text-sm text-[#7e8793] sm:block">
              Hacé click en una fila para abrir el historial
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] border-collapse text-left text-sm">
              <thead className="bg-[#13171d] text-xs uppercase tracking-wide text-[#b7c0cb]">
                <tr>
                  <TableHead>Estudiante</TableHead>
                  <TableHead>DNI</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Cohorte</TableHead>
                  <TableHead>Trayectoria</TableHead>
                  <TableHead>Detalle</TableHead>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#303741]">
                {filteredStudents.map((student) => (
                  <StudentRow key={student.id} student={student} />
                ))}
                {filteredStudents.length === 0 && (
                  <tr>
                    <td
                      className="px-4 py-12 text-center text-[#aab4c0]"
                      colSpan={6}
                    >
                      No hay estudiantes para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function StudentRow({ student }: { student: StudentProfile }) {
  const href = `/estudiantes/${encodeURIComponent(student.id)}`;

  return (
    <tr className="group align-top text-[#dfe5eb] transition hover:bg-[#20262e]">
      <td className="px-4 py-4">
        <Link
          href={href}
          className="block font-semibold text-[#fbf7ef] group-hover:text-[#5ee0c1]"
        >
          {student.lastName}, {student.firstName}
        </Link>
        <p className="mt-1 text-xs text-[#aab4c0]">
          {student.gender || "Género sin dato"}
        </p>
      </td>
      <td className="px-4 py-4 font-medium text-[#fbf7ef]">
        {student.dni ? formatDni(student.dni) : "Sin dato"}
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-[#dfe5eb]">
          {student.email || "Email sin dato"}
        </p>
        <p className="mt-1 text-xs text-[#aab4c0]">
          {student.phone || "Teléfono sin dato"}
        </p>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          {student.cohorts.map((cohort) => (
            <span
              key={cohort}
              className="rounded-full bg-[#20262e] px-2.5 py-1 text-xs font-semibold text-[#b7c0cb]"
            >
              C{cohort}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="min-w-40">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-[#dfe5eb]">
              {student.approvedModules.length}/4 módulos
            </span>
            <span className="text-[#7e8793]">aprobados</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#303741]">
            <div
              className="h-full rounded-full bg-[#5ee0c1]"
              style={{ width: `${student.approvedModules.length * 25}%` }}
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-4">
        <Link
          href={href}
          aria-label={`Ver historial de ${student.firstName} ${student.lastName}`}
          className="inline-flex h-9 items-center rounded-md border border-[#3b4652] px-3 text-sm font-semibold text-[#5ee0c1] transition hover:border-[#5ee0c1] hover:bg-[#143c36]"
        >
          Ver historial →
        </Link>
      </td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-28 rounded-lg border border-[#303741] bg-[#181c22] p-3">
      <p className="text-[11px] font-semibold uppercase text-[#aab4c0]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-[#fbf7ef]">{value}</p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#b7c0cb]">{label}</span>
      <select
        className="h-11 rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-sm text-[#f4f1ea] outline-none transition focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatDni(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
