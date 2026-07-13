"use client";

import { useMemo, useState } from "react";
import type {
  CohortId,
  DashboardData,
  ModuleId,
  StudentModuleRecord,
} from "@/lib/diplomatura-data";

type SelectValue = "all" | string;

type DashboardClientProps = {
  data: DashboardData;
};

export default function DashboardClient({ data }: DashboardClientProps) {
  const [selectedCohort, setSelectedCohort] = useState<SelectValue>("all");
  const [selectedModule, setSelectedModule] = useState<SelectValue>("all");
  const [selectedGender, setSelectedGender] = useState<SelectValue>("all");
  const [selectedResult, setSelectedResult] = useState<SelectValue>("all");
  const [search, setSearch] = useState("");

  const genderOptions = useMemo(
    () =>
      Array.from(
        new Set(data.records.map((record) => record.gender).filter(Boolean)),
      ).sort((first, second) => first.localeCompare(second, "es")),
    [data.records],
  );

  const personProgress = useMemo(() => {
    const progress = new Map<string, Set<ModuleId>>();

    for (const record of data.records) {
      if (!record.approved) {
        continue;
      }

      const modules = progress.get(record.studentId) ?? new Set<ModuleId>();
      modules.add(record.module);
      progress.set(record.studentId, modules);
    }

    return progress;
  }, [data.records]);

  const filteredRecords = useMemo(() => {
    const searchValue = normalizeSearch(search);

    return data.records.filter((record) => {
      const matchesCohort =
        selectedCohort === "all" || record.cohort === Number(selectedCohort);
      const matchesModule =
        selectedModule === "all" || record.module === Number(selectedModule);
      const matchesGender =
        selectedGender === "all" || record.gender === selectedGender;
      const matchesResult =
        selectedResult === "all" ||
        record.approved === (selectedResult === "approved");
      const matchesSearch =
        searchValue.length === 0 ||
        normalizeSearch(
          `${record.fullName} ${record.dni} ${record.email} ${record.phone}`,
        ).includes(searchValue);

      return (
        matchesCohort &&
        matchesModule &&
        matchesGender &&
        matchesResult &&
        matchesSearch
      );
    });
  }, [
    data.records,
    search,
    selectedCohort,
    selectedGender,
    selectedModule,
    selectedResult,
  ]);

  const selectedSummary = useMemo(() => {
    return {
      records: filteredRecords.length,
      approved: filteredRecords.filter((record) => record.approved).length,
      notApproved: filteredRecords.filter((record) => !record.approved).length,
    };
  }, [filteredRecords]);

  const totalPeople = new Set(data.records.map((record) => record.studentId)).size;
  const loadedSources = data.moduleSummaries.length;
  const totalSources = data.cohorts.length * data.modules.length;

  function selectCell(cohort: CohortId, module: ModuleId) {
    setSelectedCohort(String(cohort));
    setSelectedModule(String(module));
  }

  return (
    <main className="min-h-screen bg-[#0f1115] text-[#f4f1ea]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-6 border-b border-[#2d333b] pb-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase text-[#5ee0c1]">
                Dashboard academico
              </p>
              <h1 className="mt-2 max-w-4xl text-3xl font-semibold text-[#fbf7ef] sm:text-4xl">
                Diplomatura universitaria en Desarrollo Web Full Stack con
                JavaScript
              </h1>
            </div>
            <p className="max-w-3xl text-base leading-7 text-[#aab4c0]">
              Seguimiento de inscriptos y resultados por cohorte y módulo a
              partir de los registros académicos oficiales.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Metric label="Cursadas" value={data.records.length} />
            <Metric label="Personas" value={totalPeople} />
            <Metric label="Cargas" value={`${loadedSources}/${totalSources}`} />
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Alumnos filtrados"
            value={selectedSummary.records}
            tone="strong"
          />
          <Metric label="Aprobaron" value={selectedSummary.approved} />
          <Metric label="No aprobaron" value={selectedSummary.notApproved} />
        </section>

        <section className="grid gap-4 rounded-lg border border-[#303741] bg-[#181c22] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] md:grid-cols-2 xl:grid-cols-[1.2fr_repeat(4,1fr)]">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#b7c0cb]">Buscar</span>
            <input
              className="h-11 rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-sm text-[#f4f1ea] outline-none transition placeholder:text-[#687382] focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20"
              placeholder="Nombre, DNI, email o telefono"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>

          <FilterSelect
            label="Cohorte"
            value={selectedCohort}
            onChange={setSelectedCohort}
            options={data.cohorts.map((cohort) => ({
              value: String(cohort),
              label: `Cohorte ${cohort}`,
            }))}
          />

          <FilterSelect
            label="Modulo"
            value={selectedModule}
            onChange={setSelectedModule}
            options={data.modules.map((moduleItem) => ({
              value: String(moduleItem.id),
              label: `Modulo ${moduleItem.id}: ${moduleItem.shortName}`,
            }))}
          />

          <FilterSelect
            label="Genero"
            value={selectedGender}
            onChange={setSelectedGender}
            options={genderOptions.map((gender) => ({
              value: gender,
              label: gender,
            }))}
          />

          <FilterSelect
            label="Resultado"
            value={selectedResult}
            onChange={setSelectedResult}
            options={[
              { value: "approved", label: "Aprobó" },
              { value: "not-approved", label: "No aprobó" },
            ]}
          />
        </section>

        <section className="grid gap-6 lg:grid-cols-[390px_1fr]">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-[#fbf7ef]">
                Mapa de cargas
              </h2>
              <p className="text-sm text-[#aab4c0]">
                Selecciona una celda para filtrar el listado.
              </p>
            </div>

            <div className="grid grid-cols-[76px_repeat(4,minmax(0,1fr))] gap-2 text-sm">
              <div />
              {data.modules.map((moduleItem) => (
                <div
                  key={moduleItem.id}
                  className="flex h-10 items-center justify-center rounded-md bg-[#20262e] px-2 text-center text-xs font-semibold text-[#b7c0cb]"
                >
                  M{moduleItem.id}
                </div>
              ))}

              {data.cohorts.map((cohort) => (
                <CohortRow
                  key={cohort}
                  cohort={cohort}
                  summaries={data.moduleSummaries}
                  selectedCohort={selectedCohort}
                  selectedModule={selectedModule}
                  onSelect={selectCell}
                />
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[#303741] bg-[#181c22] shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col gap-2 border-b border-[#303741] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#fbf7ef]">
                  Alumnos
                </h2>
                <p className="text-sm text-[#aab4c0]">
                  {filteredRecords.length} registros visibles
                </p>
              </div>
              <button
                type="button"
                className="h-10 rounded-md border border-[#3b4652] px-3 text-sm font-medium text-[#5ee0c1] transition hover:border-[#5ee0c1] hover:bg-[#143c36]"
                onClick={() => {
                  setSelectedCohort("all");
                  setSelectedModule("all");
                  setSelectedGender("all");
                  setSelectedResult("all");
                  setSearch("");
                }}
              >
                Limpiar filtros
              </button>
            </div>

            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-[#13171d] text-xs uppercase text-[#b7c0cb]">
                  <tr>
                    <TableHead>Alumno</TableHead>
                    <TableHead>DNI</TableHead>
                    <TableHead>Cohorte</TableHead>
                    <TableHead>Modulo</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Trayectoria</TableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#303741]">
                  {filteredRecords.map((record) => (
                    <StudentRow
                      key={record.id}
                      record={record}
                      approvedModules={
                        personProgress.get(record.studentId)?.size ?? 0
                      }
                    />
                  ))}
                  {filteredRecords.length === 0 && (
                    <tr>
                      <td
                        className="px-4 py-10 text-center text-[#aab4c0]"
                        colSpan={7}
                      >
                        No hay alumnos para los filtros seleccionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "default" | "strong";
}) {
  return (
    <div
      className={
        tone === "strong"
          ? "rounded-lg border border-[#5ee0c1] bg-[#1f9d82] p-4 text-[#06110f]"
          : "rounded-lg border border-[#303741] bg-[#181c22] p-4 text-[#f4f1ea]"
      }
    >
      <p
        className={
          tone === "strong"
            ? "text-xs font-semibold uppercase text-[#06110f]/70"
            : "text-xs font-semibold uppercase text-[#aab4c0]"
        }
      >
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
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
  value: SelectValue;
  options: { value: string; label: string }[];
  onChange: (value: SelectValue) => void;
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

function CohortRow({
  cohort,
  summaries,
  selectedCohort,
  selectedModule,
  onSelect,
}: {
  cohort: CohortId;
  summaries: DashboardData["moduleSummaries"];
  selectedCohort: SelectValue;
  selectedModule: SelectValue;
  onSelect: (cohort: CohortId, module: ModuleId) => void;
}) {
  return (
    <>
      <div className="flex h-20 items-center rounded-md bg-[#20262e] px-2 text-xs font-semibold text-[#b7c0cb]">
        Cohorte {cohort}
      </div>
      {[1, 2, 3, 4].map((module) => {
        const moduleId = module as ModuleId;
        const summary = summaries.find(
          (item) => item.cohort === cohort && item.module === moduleId,
        );
        const isSelected =
          selectedCohort === String(cohort) && selectedModule === String(module);

        return (
          <button
            key={`${cohort}-${module}`}
            type="button"
            className={
              summary
                ? `flex h-20 flex-col items-center justify-center rounded-md border px-1 text-center transition ${
                    isSelected
                      ? "border-[#5ee0c1] bg-[#1f9d82] text-[#06110f]"
                      : "border-[#276b60] bg-[#123a36] text-[#9ff0db] hover:border-[#5ee0c1]"
                  }`
                : "flex h-20 flex-col items-center justify-center rounded-md border border-dashed border-[#3b4652] bg-[#12161c] px-1 text-center text-[#7e8793]"
            }
            onClick={() => onSelect(cohort, moduleId)}
          >
            <span className="text-lg font-semibold">
              {summary?.enrollmentKnown
                ? summary.enrolled
                : (summary?.approved ?? 0)}
            </span>
            <span className="text-[11px]">
              {summary?.enrollmentKnown ? "inscriptos" : "aprobaron"}
            </span>
            {summary?.enrollmentKnown && (
              <span className="text-[10px] opacity-80">
                {summary.approved} aprobaron
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function StudentRow({
  record,
  approvedModules,
}: {
  record: StudentModuleRecord;
  approvedModules: number;
}) {
  return (
    <tr className="align-top text-[#dfe5eb] transition hover:bg-[#20262e]">
      <td className="px-4 py-3">
        <p className="font-semibold text-[#fbf7ef]">
          {record.lastName}, {record.firstName}
        </p>
        <p className="text-xs text-[#aab4c0]">{record.gender}</p>
      </td>
      <td className="px-4 py-3 font-medium text-[#fbf7ef]">
        {record.dni ? formatDni(record.dni) : "Sin dato"}
      </td>
      <td className="px-4 py-3">Cohorte {record.cohort}</td>
      <td className="px-4 py-3">
        <p className="font-medium">Modulo {record.module}</p>
        <p className="text-xs text-[#aab4c0]">{record.moduleName}</p>
      </td>
      <td className="px-4 py-3">
        <a
          className="block font-medium text-[#5ee0c1] hover:underline"
          href={`mailto:${record.email}`}
        >
          {record.email}
        </a>
        <p className="text-xs text-[#aab4c0]">{record.phone}</p>
      </td>
      <td className="px-4 py-3">
        <span
          className={
            record.approved
              ? "inline-flex h-8 items-center rounded-full bg-[#123a36] px-3 text-xs font-semibold text-[#9ff0db]"
              : "inline-flex h-8 items-center rounded-full bg-[#3b2528] px-3 text-xs font-semibold text-[#ffb4ad]"
          }
        >
          {record.approved ? "Aprobó" : "No aprobó"}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex h-8 items-center rounded-full bg-[#20262e] px-3 text-xs font-semibold text-[#b7c0cb]">
          {approvedModules}/4 modulos
        </span>
      </td>
    </tr>
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
