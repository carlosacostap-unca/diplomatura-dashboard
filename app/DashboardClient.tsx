"use client";

import { useMemo, useState } from "react";
import type {
  CohortId,
  DashboardData,
  GraduateRecord,
  ModuleId,
} from "@/lib/diplomatura-data";

type SelectValue = "all" | string;

type DashboardClientProps = {
  data: DashboardData;
};

export default function DashboardClient({ data }: DashboardClientProps) {
  const [selectedCohort, setSelectedCohort] = useState<SelectValue>("all");
  const [selectedModule, setSelectedModule] = useState<SelectValue>("all");
  const [selectedGender, setSelectedGender] = useState<SelectValue>("all");
  const [search, setSearch] = useState("");

  const genderOptions = useMemo(
    () =>
      Array.from(new Set(data.records.map((record) => record.gender))).sort(
        (first, second) => first.localeCompare(second, "es"),
      ),
    [data.records],
  );

  const personProgress = useMemo(() => {
    const progress = new Map<string, Set<ModuleId>>();

    for (const record of data.records) {
      const modules = progress.get(record.dni) ?? new Set<ModuleId>();
      modules.add(record.module);
      progress.set(record.dni, modules);
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
      const matchesSearch =
        searchValue.length === 0 ||
        normalizeSearch(
          `${record.fullName} ${record.dni} ${record.email} ${record.phone}`,
        ).includes(searchValue);

      return matchesCohort && matchesModule && matchesGender && matchesSearch;
    });
  }, [data.records, search, selectedCohort, selectedGender, selectedModule]);

  const selectedSummary = useMemo(() => {
    const uniquePeople = new Set(filteredRecords.map((record) => record.dni));
    const emails = new Set(filteredRecords.map((record) => record.email));

    return {
      records: filteredRecords.length,
      people: uniquePeople.size,
      emails: emails.size,
    };
  }, [filteredRecords]);

  const totalPeople = new Set(data.records.map((record) => record.dni)).size;
  const loadedSources = data.moduleSummaries.length;
  const totalSources = data.cohorts.length * data.modules.length;

  function selectCell(cohort: CohortId, module: ModuleId) {
    setSelectedCohort(String(cohort));
    setSelectedModule(String(module));
  }

  return (
    <main className="min-h-screen bg-[#f6f4ee] text-[#1f2933]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-6 border-b border-[#d8d1c4] pb-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase text-[#287271]">
                Dashboard academico
              </p>
              <h1 className="mt-2 max-w-4xl text-3xl font-semibold text-[#17202a] sm:text-4xl">
                Diplomatura universitaria en Desarrollo Web Full Stack con
                JavaScript
              </h1>
            </div>
            <p className="max-w-3xl text-base leading-7 text-[#53616f]">
              Seguimiento de egresados por cohorte y modulo a partir de los CSV
              oficiales de aprobacion.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Metric label="Registros" value={data.records.length} />
            <Metric label="Personas" value={totalPeople} />
            <Metric label="Cargas" value={`${loadedSources}/${totalSources}`} />
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Metric
            label="Egresados filtrados"
            value={selectedSummary.records}
            tone="strong"
          />
          <Metric label="DNI unicos" value={selectedSummary.people} />
          <Metric label="Correos unicos" value={selectedSummary.emails} />
        </section>

        <section className="grid gap-4 rounded-lg border border-[#d8d1c4] bg-white p-4 shadow-sm lg:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#53616f]">Buscar</span>
            <input
              className="h-11 rounded-md border border-[#c9d2d0] bg-white px-3 text-sm outline-none transition focus:border-[#287271] focus:ring-2 focus:ring-[#287271]/20"
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
        </section>

        <section className="grid gap-6 lg:grid-cols-[390px_1fr]">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-[#17202a]">
                Mapa de cargas
              </h2>
              <p className="text-sm text-[#53616f]">
                Selecciona una celda para filtrar el listado.
              </p>
            </div>

            <div className="grid grid-cols-[76px_repeat(4,minmax(0,1fr))] gap-2 text-sm">
              <div />
              {data.modules.map((moduleItem) => (
                <div
                  key={moduleItem.id}
                  className="flex h-10 items-center justify-center rounded-md bg-[#e7ebe5] px-2 text-center text-xs font-semibold text-[#53616f]"
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

          <div className="overflow-hidden rounded-lg border border-[#d8d1c4] bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-[#e6e0d5] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#17202a]">
                  Egresados
                </h2>
                <p className="text-sm text-[#53616f]">
                  {filteredRecords.length} registros visibles
                </p>
              </div>
              <button
                type="button"
                className="h-10 rounded-md border border-[#c9d2d0] px-3 text-sm font-medium text-[#287271] transition hover:bg-[#eef6f5]"
                onClick={() => {
                  setSelectedCohort("all");
                  setSelectedModule("all");
                  setSelectedGender("all");
                  setSearch("");
                }}
              >
                Limpiar filtros
              </button>
            </div>

            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[860px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-[#f8f6f0] text-xs uppercase text-[#53616f]">
                  <tr>
                    <TableHead>Alumno</TableHead>
                    <TableHead>DNI</TableHead>
                    <TableHead>Cohorte</TableHead>
                    <TableHead>Modulo</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Trayectoria</TableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ece6dc]">
                  {filteredRecords.map((record) => (
                    <GraduateRow
                      key={record.id}
                      record={record}
                      approvedModules={personProgress.get(record.dni)?.size ?? 1}
                    />
                  ))}
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
          ? "rounded-lg border border-[#287271] bg-[#287271] p-4 text-white"
          : "rounded-lg border border-[#d8d1c4] bg-white p-4 text-[#17202a]"
      }
    >
      <p
        className={
          tone === "strong"
            ? "text-xs font-semibold uppercase text-white/75"
            : "text-xs font-semibold uppercase text-[#53616f]"
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
      <span className="text-sm font-medium text-[#53616f]">{label}</span>
      <select
        className="h-11 rounded-md border border-[#c9d2d0] bg-white px-3 text-sm outline-none transition focus:border-[#287271] focus:ring-2 focus:ring-[#287271]/20"
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
      <div className="flex h-16 items-center rounded-md bg-[#e7ebe5] px-2 text-xs font-semibold text-[#53616f]">
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
                ? `flex h-16 flex-col items-center justify-center rounded-md border px-1 text-center transition ${
                    isSelected
                      ? "border-[#287271] bg-[#287271] text-white"
                      : "border-[#b7d4cf] bg-[#eef6f5] text-[#1f6868] hover:border-[#287271]"
                  }`
                : "flex h-16 flex-col items-center justify-center rounded-md border border-dashed border-[#d8d1c4] bg-white px-1 text-center text-[#9a8f80]"
            }
            onClick={() => onSelect(cohort, moduleId)}
          >
            <span className="text-lg font-semibold">{summary?.count ?? 0}</span>
            <span className="text-[11px]">egresados</span>
          </button>
        );
      })}
    </>
  );
}

function GraduateRow({
  record,
  approvedModules,
}: {
  record: GraduateRecord;
  approvedModules: number;
}) {
  return (
    <tr className="align-top transition hover:bg-[#faf8f3]">
      <td className="px-4 py-3">
        <p className="font-semibold text-[#17202a]">
          {record.lastName}, {record.firstName}
        </p>
        <p className="text-xs text-[#53616f]">{record.gender}</p>
      </td>
      <td className="px-4 py-3 font-medium text-[#17202a]">
        {formatDni(record.dni)}
      </td>
      <td className="px-4 py-3">Cohorte {record.cohort}</td>
      <td className="px-4 py-3">
        <p className="font-medium">Modulo {record.module}</p>
        <p className="text-xs text-[#53616f]">{record.moduleName}</p>
      </td>
      <td className="px-4 py-3">
        <a
          className="block font-medium text-[#287271] hover:underline"
          href={`mailto:${record.email}`}
        >
          {record.email}
        </a>
        <p className="text-xs text-[#53616f]">{record.phone}</p>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex h-8 items-center rounded-full bg-[#e7ebe5] px-3 text-xs font-semibold text-[#53616f]">
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
