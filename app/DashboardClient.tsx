"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  CohortId,
  DashboardData,
  ModuleId,
  StudentModuleRecord,
} from "@/lib/diplomatura-data";
import {
  buildDashboardAnalytics,
  type DashboardAnalytics,
  type DataQualityIssue,
} from "./dashboard-analytics";

type SelectValue = "all" | string;
type SortKey = "name" | "dni" | "result" | "trajectory";
type SortDirection = "asc" | "desc";
type IssueStatus = "pending" | "reviewed" | "resolved";
type IssueFilter = "all" | IssueStatus;

type DashboardClientProps = {
  data: DashboardData;
};

type SavedFilters = {
  selectedCohort: SelectValue;
  selectedModule: SelectValue;
  selectedGender: SelectValue;
  selectedResult: SelectValue;
  selectedEnrollmentType: SelectValue;
  search: string;
  sortKey: SortKey;
  sortDirection: SortDirection;
  page: number;
};

const FILTER_STORAGE_KEY = "diplomatura-dashboard-filters-v1";
const ISSUE_STORAGE_KEY = "diplomatura-dashboard-issues-v1";
const PAGE_SIZE = 100;

export default function DashboardClient({ data }: DashboardClientProps) {
  const router = useRouter();
  const [selectedCohort, setSelectedCohort] = useState<SelectValue>("all");
  const [selectedModule, setSelectedModule] = useState<SelectValue>("all");
  const [selectedGender, setSelectedGender] = useState<SelectValue>("all");
  const [selectedResult, setSelectedResult] = useState<SelectValue>("all");
  const [selectedEnrollmentType, setSelectedEnrollmentType] =
    useState<SelectValue>("all");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [page, setPage] = useState(1);
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const [issueStatuses, setIssueStatuses] = useState<
    Record<string, IssueStatus>
  >({});
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("pending");

  useEffect(() => {
    try {
      const storedFilters = sessionStorage.getItem(FILTER_STORAGE_KEY);
      const storedIssues = localStorage.getItem(ISSUE_STORAGE_KEY);
      const saved = storedFilters
        ? (JSON.parse(storedFilters) as Partial<SavedFilters>)
        : null;
      const savedIssues = storedIssues
        ? (JSON.parse(storedIssues) as Record<string, IssueStatus>)
        : {};

      queueMicrotask(() => {
        if (saved?.selectedCohort) setSelectedCohort(saved.selectedCohort);
        if (saved?.selectedModule) setSelectedModule(saved.selectedModule);
        if (saved?.selectedGender) setSelectedGender(saved.selectedGender);
        if (saved?.selectedResult) setSelectedResult(saved.selectedResult);
        if (saved?.selectedEnrollmentType) {
          setSelectedEnrollmentType(saved.selectedEnrollmentType);
        }
        if (typeof saved?.search === "string") setSearch(saved.search);
        if (saved?.sortKey) setSortKey(saved.sortKey);
        if (saved?.sortDirection) setSortDirection(saved.sortDirection);
        if (saved?.page && saved.page > 0) setPage(saved.page);
        setIssueStatuses(savedIssues);
        setFiltersHydrated(true);
      });
    } catch {
      sessionStorage.removeItem(FILTER_STORAGE_KEY);
      localStorage.removeItem(ISSUE_STORAGE_KEY);
      queueMicrotask(() => setFiltersHydrated(true));
    }
  }, []);

  useEffect(() => {
    if (!filtersHydrated) return;

    const saved: SavedFilters = {
      selectedCohort,
      selectedModule,
      selectedGender,
      selectedResult,
      selectedEnrollmentType,
      search,
      sortKey,
      sortDirection,
      page,
    };
    sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(saved));
  }, [
    filtersHydrated,
    page,
    search,
    selectedCohort,
    selectedEnrollmentType,
    selectedGender,
    selectedModule,
    selectedResult,
    sortDirection,
    sortKey,
  ]);

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
      const modules = progress.get(record.studentId) ?? new Set<ModuleId>();
      if (record.approved) modules.add(record.module);
      progress.set(record.studentId, modules);
    }

    return progress;
  }, [data.records]);

  const analytics = useMemo(
    () => buildDashboardAnalytics(data, selectedCohort),
    [data, selectedCohort],
  );

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
      const matchesEnrollmentType =
        selectedEnrollmentType === "all" ||
        record.enrollmentType === selectedEnrollmentType;
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
        matchesEnrollmentType &&
        matchesSearch
      );
    });
  }, [
    data.records,
    search,
    selectedCohort,
    selectedGender,
    selectedEnrollmentType,
    selectedModule,
    selectedResult,
  ]);

  const sortedRecords = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;

    return [...filteredRecords].sort((first, second) => {
      let comparison = 0;
      if (sortKey === "name") {
        comparison = first.fullName.localeCompare(second.fullName, "es");
      } else if (sortKey === "dni") {
        comparison = (first.dni || "999999999").localeCompare(
          second.dni || "999999999",
          "es",
          { numeric: true },
        );
      } else if (sortKey === "result") {
        comparison = Number(first.approved) - Number(second.approved);
      } else {
        comparison =
          (personProgress.get(first.studentId)?.size ?? 0) -
          (personProgress.get(second.studentId)?.size ?? 0);
      }

      return (
        comparison * multiplier ||
        first.fullName.localeCompare(second.fullName, "es")
      );
    });
  }, [filteredRecords, personProgress, sortDirection, sortKey]);

  const selectedSummary = useMemo(
    () => ({
      records: filteredRecords.length,
      approved: filteredRecords.filter((record) => record.approved).length,
      notApproved: filteredRecords.filter((record) => !record.approved).length,
      enrolled: filteredRecords.filter((record) => record.enrollmentKnown)
        .length,
      newStudents: filteredRecords.filter(
        (record) => record.enrollmentType === "new",
      ).length,
      repeaters: filteredRecords.filter(
        (record) => record.enrollmentType === "repeater",
      ).length,
    }),
    [filteredRecords],
  );

  const selectedCellSummary = useMemo(() => {
    if (selectedCohort === "all" || selectedModule === "all") return null;

    const cohort = Number(selectedCohort) as CohortId;
    const moduleId = Number(selectedModule) as ModuleId;
    const current = data.moduleSummaries.find(
      (summary) => summary.cohort === cohort && summary.module === moduleId,
    );
    const previous = data.moduleSummaries.find(
      (summary) => summary.cohort === cohort - 1 && summary.module === moduleId,
    );
    const currentRate = getApprovalRate(current);
    const previousRate = getApprovalRate(previous);

    return {
      cohort,
      module: moduleId,
      current,
      currentRate,
      previousRate,
      difference:
        currentRate != null && previousRate != null
          ? currentRate - previousRate
          : null,
    };
  }, [data.moduleSummaries, selectedCohort, selectedModule]);

  const totalPages = Math.max(1, Math.ceil(sortedRecords.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRecords = sortedRecords.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const totalPeople = new Set(data.records.map((record) => record.studentId))
    .size;
  const loadedSources = data.moduleSummaries.length;
  const totalSources = data.cohorts.length * data.modules.length;

  function updateFilter(callback: () => void) {
    setPage(1);
    callback();
  }

  function selectCell(cohort: CohortId, module: ModuleId) {
    updateFilter(() => {
      setSelectedCohort(String(cohort));
      setSelectedModule(String(module));
    });
  }

  function clearFilters() {
    updateFilter(() => {
      setSelectedCohort("all");
      setSelectedModule("all");
      setSelectedGender("all");
      setSelectedResult("all");
      setSelectedEnrollmentType("all");
      setSearch("");
    });
  }

  function changeSort(nextSortKey: SortKey) {
    setPage(1);
    if (sortKey === nextSortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  function updateIssueStatus(issueId: string, status: IssueStatus) {
    setIssueStatuses((current) => {
      const next = { ...current, [issueId]: status };
      localStorage.setItem(ISSUE_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function openStudent(studentId: string) {
    router.push(`/estudiantes/${studentId}`);
  }

  function exportFilteredRecords() {
    const headers = [
      "Alumno",
      "DNI",
      "Cohorte",
      "Modulo",
      "Email",
      "Telefono",
      "Resultado",
      "Inscripcion",
      "Modulos aprobados",
    ];
    const rows = sortedRecords.map((record) => [
      record.fullName,
      record.dni,
      record.cohort,
      record.module,
      record.email,
      record.phone,
      record.approved ? "Aprobo" : "No aprobo",
      enrollmentTypeLabel(record.enrollmentType),
      personProgress.get(record.studentId)?.size ?? 0,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `alumnos-filtrados-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#0f1115] text-[#f4f1ea]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="grid gap-6 border-b border-[#2d333b] pb-6 lg:grid-cols-[1fr_360px] lg:items-end">
          <div className="space-y-4">
            <nav className="flex items-center gap-2 text-sm" aria-label="Navegación principal">
              <span className="rounded-md bg-[#143c36] px-3 py-2 font-semibold text-[#9ff0db]">
                Dashboard
              </span>
              <Link
                href="/estudiantes"
                className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
              >
                Estudiantes
              </Link>
              <Link
                href="/calidad-datos"
                className="rounded-md px-3 py-2 font-medium text-[#aab4c0] transition hover:bg-[#20262e] hover:text-[#fbf7ef]"
              >
                Calidad de datos
              </Link>
            </nav>
            <div>
              <p className="text-sm font-semibold uppercase text-[#5ee0c1]">
                Dashboard académico
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

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric label="Registros" value={selectedSummary.records} tone="strong" />
          <Metric label="Inscriptos" value={selectedSummary.enrolled} />
          <Metric label="Aprobaron" value={selectedSummary.approved} />
          <Metric label="No aprobaron" value={selectedSummary.notApproved} />
          <Metric label="Nuevos" value={selectedSummary.newStudents} />
          <Metric label="Recursantes" value={selectedSummary.repeaters} />
        </section>

        <AcademicEvolution analytics={analytics} selectedCohort={selectedCohort} />

        <section className="grid gap-4 rounded-lg border border-[#303741] bg-[#181c22] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] md:grid-cols-2 xl:grid-cols-[1.2fr_repeat(5,1fr)]">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[#b7c0cb]">Buscar</span>
            <input
              className="h-11 rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-sm text-[#f4f1ea] outline-none transition placeholder:text-[#687382] focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20"
              placeholder="Nombre, DNI, email o teléfono"
              value={search}
              onChange={(event) => updateFilter(() => setSearch(event.target.value))}
            />
          </label>

          <FilterSelect
            label="Cohorte"
            value={selectedCohort}
            onChange={(value) => updateFilter(() => setSelectedCohort(value))}
            options={data.cohorts.map((cohort) => ({
              value: String(cohort),
              label: `Cohorte ${cohort}`,
            }))}
          />
          <FilterSelect
            label="Módulo"
            value={selectedModule}
            onChange={(value) => updateFilter(() => setSelectedModule(value))}
            options={data.modules.map((moduleItem) => ({
              value: String(moduleItem.id),
              label: `Módulo ${moduleItem.id}: ${moduleItem.shortName}`,
            }))}
          />
          <FilterSelect
            label="Género"
            value={selectedGender}
            onChange={(value) => updateFilter(() => setSelectedGender(value))}
            options={genderOptions.map((gender) => ({ value: gender, label: gender }))}
          />
          <FilterSelect
            label="Resultado"
            value={selectedResult}
            onChange={(value) => updateFilter(() => setSelectedResult(value))}
            options={[
              { value: "approved", label: "Aprobó" },
              { value: "not-approved", label: "No aprobó" },
            ]}
          />
          <FilterSelect
            label="Tipo de inscripción"
            value={selectedEnrollmentType}
            onChange={(value) => updateFilter(() => setSelectedEnrollmentType(value))}
            options={[
              { value: "new", label: "Nuevo" },
              { value: "repeater", label: "Recursante" },
              { value: "unknown", label: "Sin clasificar" },
            ]}
          />
        </section>

        <section className="space-y-6">
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-[#fbf7ef]">Mapa de cargas</h2>
              <p className="text-sm text-[#aab4c0]">
                Seleccioná una celda para filtrar y comparar su desempeño.
              </p>
            </div>

            <div className="overflow-x-auto pb-1">
              <div className="grid min-w-[680px] grid-cols-[100px_repeat(4,minmax(130px,1fr))] gap-2 text-sm">
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
          </div>

          {selectedCellSummary && <CellSummary summary={selectedCellSummary} />}

          <DataQualityPanel
            issues={analytics.issues}
            statuses={issueStatuses}
            filter={issueFilter}
            onFilterChange={setIssueFilter}
            onStatusChange={updateIssueStatus}
          />

          <div className="overflow-hidden rounded-lg border border-[#303741] bg-[#181c22] shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
            <div className="flex flex-col gap-3 border-b border-[#303741] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#fbf7ef]">Alumnos</h2>
                <p className="text-sm text-[#aab4c0]">
                  {sortedRecords.length} registros filtrados
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="h-10 rounded-md border border-[#3b4652] px-3 text-sm font-medium text-[#a9d8ff] transition hover:border-[#76bfff] hover:bg-[#1d3040] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={exportFilteredRecords}
                  disabled={sortedRecords.length === 0}
                >
                  Exportar CSV
                </button>
                <button
                  type="button"
                  className="h-10 rounded-md border border-[#3b4652] px-3 text-sm font-medium text-[#5ee0c1] transition hover:border-[#5ee0c1] hover:bg-[#143c36]"
                  onClick={clearFilters}
                >
                  Limpiar filtros
                </button>
              </div>
            </div>

            <div className="max-h-[620px] overflow-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[#13171d] text-xs uppercase text-[#b7c0cb]">
                  <tr>
                    <SortableTableHead sortKey="name" activeKey={sortKey} direction={sortDirection} onSort={changeSort}>Alumno</SortableTableHead>
                    <SortableTableHead sortKey="dni" activeKey={sortKey} direction={sortDirection} onSort={changeSort}>DNI</SortableTableHead>
                    <TableHead>Cohorte</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Contacto</TableHead>
                    <SortableTableHead sortKey="result" activeKey={sortKey} direction={sortDirection} onSort={changeSort}>Resultado</SortableTableHead>
                    <TableHead>Inscripción</TableHead>
                    <SortableTableHead sortKey="trajectory" activeKey={sortKey} direction={sortDirection} onSort={changeSort}>Trayectoria</SortableTableHead>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#303741]">
                  {visibleRecords.map((record) => (
                    <StudentRow
                      key={record.id}
                      record={record}
                      approvedModules={personProgress.get(record.studentId)?.size ?? 0}
                      onOpen={() => openStudent(record.studentId)}
                    />
                  ))}
                  {visibleRecords.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-[#aab4c0]" colSpan={8}>
                        No hay alumnos para los filtros seleccionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={safePage}
              totalPages={totalPages}
              totalRecords={sortedRecords.length}
              onPageChange={setPage}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function AcademicEvolution({
  analytics,
  selectedCohort,
}: {
  analytics: DashboardAnalytics;
  selectedCohort: SelectValue;
}) {
  return (
    <section className="space-y-4" aria-labelledby="academic-evolution-title">
      <div>
        <h2 id="academic-evolution-title" className="text-lg font-semibold text-[#fbf7ef]">
          Evolución académica
        </h2>
        <p className="text-sm text-[#aab4c0]">
          Retención, avance y composición de las cohortes.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InsightMetric label="Diplomados" value={analytics.graduates} detail="4 módulos aprobados" tone="teal" />
        <InsightMetric label="En avance" value={analytics.withProgress} detail="Entre 1 y 3 módulos" tone="blue" />
        <InsightMetric label="Sin aprobaciones" value={analytics.withoutApprovals} detail="Alumnos sin módulos aprobados" tone="red" />
        <InsightMetric label="Recursantes" value={analytics.repeaters} detail="Personas identificadas" tone="amber" />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_1.35fr]">
        <RetentionChart points={analytics.retention} selectedCohort={selectedCohort} />
        <CohortPerformanceChart rows={analytics.cohortPerformance} />
      </div>
      <EnrollmentMixChart rows={analytics.enrollmentMix} />
    </section>
  );
}

function RetentionChart({
  points,
  selectedCohort,
}: {
  points: DashboardAnalytics["retention"];
  selectedCohort: SelectValue;
}) {
  const coordinates = points.map((point, index) => ({
    ...point,
    x: 54 + index * 154,
    y: 142 - Math.min(point.percentage, 100) * 1.02,
  }));
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div className="min-w-0 rounded-lg border border-[#303741] bg-[#181c22] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[#fbf7ef]">Embudo de retención</h3>
          <p className="text-xs text-[#aab4c0]">
            {selectedCohort === "all" ? "Todas las cohortes" : `Cohorte ${selectedCohort}`} · base M1
          </p>
        </div>
        <span className="rounded-md bg-[#143c36] px-2 py-1 text-xs font-semibold text-[#9ff0db]">
          M1 → M4
        </span>
      </div>
      <svg className="mt-3 h-auto w-full max-w-full" viewBox="0 0 570 190" role="img" aria-label="Retención desde el módulo uno hasta el módulo cuatro">
        {[40, 80, 120].map((y) => (
          <line key={y} x1="40" y1={y} x2="540" y2={y} stroke="#303741" strokeWidth="1" />
        ))}
        <polyline points={polyline} fill="none" stroke="#5ee0c1" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
        {coordinates.map((point) => (
          <g key={point.module}>
            <circle cx={point.x} cy={point.y} r="7" fill="#0f1115" stroke="#5ee0c1" strokeWidth="4" />
            <text x={point.x} y={Math.max(18, point.y - 14)} fill="#fbf7ef" fontSize="13" fontWeight="600" textAnchor="middle">
              {point.percentage}%
            </text>
            <text x={point.x} y="166" fill="#b7c0cb" fontSize="12" textAnchor="middle">M{point.module}</text>
            <text x={point.x} y="183" fill="#7e8793" fontSize="11" textAnchor="middle">{point.enrolled} inscriptos</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CohortPerformanceChart({
  rows,
}: {
  rows: DashboardAnalytics["cohortPerformance"];
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#303741] bg-[#181c22] p-4">
      <h3 className="font-semibold text-[#fbf7ef]">Tasa de aprobación por cohorte</h3>
      <p className="text-xs text-[#aab4c0]">Comparación módulo por módulo</p>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[570px] space-y-3">
          <div className="grid grid-cols-[72px_repeat(4,1fr)] gap-3 text-center text-[11px] font-semibold uppercase text-[#7e8793]">
            <span />
            {[1, 2, 3, 4].map((module) => <span key={module}>M{module}</span>)}
          </div>
          {rows.map((row) => (
            <div key={row.cohort} className="grid grid-cols-[72px_repeat(4,1fr)] items-center gap-3">
              <span className="text-xs font-semibold text-[#b7c0cb]">Cohorte {row.cohort}</span>
              {row.modules.map((module) => (
                <div key={module.module} className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-sm bg-[#10141a]">
                    <div className={approvalBarTone(module.rate)} style={{ width: `${module.enrollmentKnown ? module.rate : 0}%` }} />
                  </div>
                  <p className="text-center text-[11px] text-[#b7c0cb]">
                    {module.enrollmentKnown ? `${module.rate}%` : "s/d"}
                  </p>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EnrollmentMixChart({ rows }: { rows: DashboardAnalytics["enrollmentMix"] }) {
  const maximum = Math.max(1, ...rows.map((row) => row.total));

  return (
    <div className="rounded-lg border border-[#303741] bg-[#181c22] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="font-semibold text-[#fbf7ef]">Nuevos y recursantes</h3>
          <p className="text-xs text-[#aab4c0]">Composición de inscripciones conocidas</p>
        </div>
        <div className="flex gap-4 text-xs text-[#b7c0cb]">
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-[#4ba3df]" />Nuevos</span>
          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 bg-[#d8a13f]" />Recursantes</span>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.cohort} className="grid grid-cols-[74px_1fr_48px] items-center gap-3">
            <span className="text-xs font-semibold text-[#b7c0cb]">Cohorte {row.cohort}</span>
            <div className="flex h-3 overflow-hidden rounded-sm bg-[#10141a]">
              <span className="bg-[#4ba3df]" style={{ width: `${(row.newStudents / maximum) * 100}%` }} />
              <span className="bg-[#d8a13f]" style={{ width: `${(row.repeaters / maximum) * 100}%` }} />
            </div>
            <span className="text-right text-xs text-[#aab4c0]">{row.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "teal" | "blue" | "red" | "amber";
}) {
  const toneClass = {
    teal: "border-l-[#5ee0c1]",
    blue: "border-l-[#4ba3df]",
    red: "border-l-[#df6b72]",
    amber: "border-l-[#d8a13f]",
  }[tone];

  return (
    <div className={`border-l-4 bg-[#181c22] px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-semibold uppercase text-[#aab4c0]">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-[#fbf7ef]">{value}</span>
        <span className="text-xs text-[#7e8793]">{detail}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number | string; tone?: "default" | "strong" }) {
  return (
    <div className={tone === "strong" ? "rounded-lg border border-[#5ee0c1] bg-[#1f9d82] p-4 text-[#06110f]" : "rounded-lg border border-[#303741] bg-[#181c22] p-4 text-[#f4f1ea]"}>
      <p className={tone === "strong" ? "text-xs font-semibold uppercase text-[#06110f]/70" : "text-xs font-semibold uppercase text-[#aab4c0]"}>{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: SelectValue; options: { value: string; label: string }[]; onChange: (value: SelectValue) => void }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-[#b7c0cb]">{label}</span>
      <select className="h-11 rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-sm text-[#f4f1ea] outline-none transition focus:border-[#5ee0c1] focus:ring-2 focus:ring-[#5ee0c1]/20" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">Todos</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function CohortRow({ cohort, summaries, selectedCohort, selectedModule, onSelect }: { cohort: CohortId; summaries: DashboardData["moduleSummaries"]; selectedCohort: SelectValue; selectedModule: SelectValue; onSelect: (cohort: CohortId, module: ModuleId) => void }) {
  return (
    <>
      <div className="flex h-24 items-center rounded-md bg-[#20262e] px-2 text-xs font-semibold text-[#b7c0cb]">Cohorte {cohort}</div>
      {[1, 2, 3, 4].map((module) => {
        const moduleId = module as ModuleId;
        const summary = summaries.find((item) => item.cohort === cohort && item.module === moduleId);
        const isSelected = selectedCohort === String(cohort) && selectedModule === String(module);
        const rate = getApprovalRate(summary);

        return (
          <button
            key={`${cohort}-${module}`}
            type="button"
            className={summary ? `flex h-24 flex-col items-center justify-center rounded-md border px-1 text-center transition ${isSelected ? "border-[#5ee0c1] bg-[#1f9d82] text-[#06110f]" : rateTone(rate)}` : "flex h-24 flex-col items-center justify-center rounded-md border border-dashed border-[#3b4652] bg-[#12161c] px-1 text-center text-[#7e8793]"}
            onClick={() => onSelect(cohort, moduleId)}
            aria-label={`Cohorte ${cohort}, módulo ${module}`}
          >
            <span className="text-lg font-semibold">{summary?.enrollmentKnown ? summary.enrolled : (summary?.approved ?? 0)}</span>
            <span className="text-[11px]">{summary?.enrollmentKnown ? "inscriptos" : summary ? "aprobaron" : "sin carga"}</span>
            {summary?.enrollmentKnown && <span className="text-[10px] opacity-80">{summary.approved} aprobaron</span>}
            {rate != null && <span className="mt-1 text-xs font-semibold">{rate}% aprobación</span>}
          </button>
        );
      })}
    </>
  );
}

function CellSummary({
  summary,
}: {
  summary: {
    cohort: CohortId;
    module: ModuleId;
    current: DashboardData["moduleSummaries"][number] | undefined;
    currentRate: number | null;
    previousRate: number | null;
    difference: number | null;
  };
}) {
  const differenceLabel = summary.difference == null ? "Sin base comparable" : `${summary.difference > 0 ? "+" : ""}${summary.difference} pp`;

  return (
    <div className="grid gap-4 border-y border-[#303741] py-4 sm:grid-cols-[1fr_repeat(4,minmax(100px,auto))] sm:items-center">
      <div>
        <p className="text-xs font-semibold uppercase text-[#5ee0c1]">Selección actual</p>
        <h3 className="mt-1 font-semibold text-[#fbf7ef]">Cohorte {summary.cohort} · Módulo {summary.module}</h3>
      </div>
      <InlineStat label="Inscriptos" value={summary.current?.enrollmentKnown ? summary.current.enrolled : "s/d"} />
      <InlineStat label="Aprobaron" value={summary.current?.approved ?? 0} />
      <InlineStat label="Aprobación" value={summary.currentRate == null ? "s/d" : `${summary.currentRate}%`} />
      <InlineStat label="Vs. cohorte anterior" value={differenceLabel} tone={summary.difference == null ? "neutral" : summary.difference >= 0 ? "positive" : "negative"} />
    </div>
  );
}

function InlineStat({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "positive" | "negative" }) {
  const color = tone === "positive" ? "text-[#5ee0c1]" : tone === "negative" ? "text-[#ff9b96]" : "text-[#fbf7ef]";
  return <div><p className="text-[11px] uppercase text-[#7e8793]">{label}</p><p className={`mt-1 text-sm font-semibold ${color}`}>{value}</p></div>;
}

function DataQualityPanel({ issues, statuses, filter, onFilterChange, onStatusChange }: { issues: DataQualityIssue[]; statuses: Record<string, IssueStatus>; filter: IssueFilter; onFilterChange: (filter: IssueFilter) => void; onStatusChange: (id: string, status: IssueStatus) => void }) {
  const count = (status: IssueStatus) => issues.filter((issue) => (statuses[issue.id] ?? "pending") === status).length;
  const filtered = filter === "all" ? issues : issues.filter((issue) => (statuses[issue.id] ?? "pending") === filter);

  return (
    <details className="rounded-lg border border-[#303741] bg-[#181c22]" open={count("pending") > 0}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4">
        <div>
          <h2 className="font-semibold text-[#fbf7ef]">Calidad de datos</h2>
          <p className="text-sm text-[#aab4c0]">{count("pending")} pendientes · {count("reviewed")} revisadas · {count("resolved")} resueltas</p>
        </div>
        <span className={count("pending") > 0 ? "rounded-md bg-[#3d321d] px-3 py-1 text-sm font-semibold text-[#ffd58a]" : "rounded-md bg-[#143c36] px-3 py-1 text-sm font-semibold text-[#9ff0db]"}>{count("pending")}</span>
      </summary>
      <div className="border-t border-[#303741] p-4">
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar inconsistencias">
          {(["pending", "reviewed", "resolved", "all"] as IssueFilter[]).map((value) => (
            <button key={value} type="button" className={filter === value ? "h-9 rounded-md bg-[#1d3040] px-3 text-xs font-semibold text-[#a9d8ff]" : "h-9 rounded-md px-3 text-xs font-medium text-[#aab4c0] hover:bg-[#20262e]"} onClick={() => onFilterChange(value)}>{issueFilterLabel(value)}</button>
          ))}
        </div>
        <div className="max-h-80 divide-y divide-[#303741] overflow-y-auto">
          {filtered.map((issue) => {
            const status = statuses[issue.id] ?? "pending";
            return (
              <div key={issue.id} className="grid gap-3 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <Link href={`/estudiantes/${issue.studentId}`} className="font-semibold text-[#fbf7ef] hover:text-[#5ee0c1] hover:underline">{issue.studentName}</Link>
                  <p className="text-sm text-[#dfe5eb]">{issue.title}</p>
                  <p className="text-xs text-[#7e8793]">{issue.detail}</p>
                </div>
                <select aria-label={`Estado de ${issue.title} para ${issue.studentName}`} className="h-9 rounded-md border border-[#3b4652] bg-[#10141a] px-3 text-xs text-[#f4f1ea]" value={status} onChange={(event) => onStatusChange(issue.id, event.target.value as IssueStatus)}>
                  <option value="pending">Pendiente</option>
                  <option value="reviewed">Revisada</option>
                  <option value="resolved">Resuelta</option>
                </select>
              </div>
            );
          })}
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-[#aab4c0]">No hay inconsistencias en este estado.</p>}
        </div>
      </div>
    </details>
  );
}

function StudentRow({ record, approvedModules, onOpen }: { record: StudentModuleRecord; approvedModules: number; onOpen: () => void }) {
  return (
    <tr tabIndex={0} role="link" aria-label={`Abrir ficha de ${record.fullName}`} className="cursor-pointer align-top text-[#dfe5eb] transition hover:bg-[#20262e] focus:bg-[#20262e] focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#5ee0c1]" onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}>
      <td className="px-4 py-3"><p className="font-semibold text-[#fbf7ef]">{record.lastName}, {record.firstName}</p><p className="text-xs text-[#aab4c0]">{record.gender}</p></td>
      <td className="px-4 py-3 font-medium text-[#fbf7ef]">{record.dni ? formatDni(record.dni) : "Sin dato"}</td>
      <td className="px-4 py-3">Cohorte {record.cohort}</td>
      <td className="px-4 py-3"><p className="font-medium">Módulo {record.module}</p><p className="text-xs text-[#aab4c0]">{record.moduleName}</p></td>
      <td className="px-4 py-3">
        {record.email ? <a className="block font-medium text-[#5ee0c1] hover:underline" href={`mailto:${record.email}`} onClick={(event) => event.stopPropagation()}>{record.email}</a> : <span className="text-[#7e8793]">Sin correo</span>}
        <p className="text-xs text-[#aab4c0]">{record.phone || "Sin teléfono"}</p>
      </td>
      <td className="px-4 py-3"><span className={record.approved ? "inline-flex h-8 items-center rounded-full bg-[#123a36] px-3 text-xs font-semibold text-[#9ff0db]" : "inline-flex h-8 items-center rounded-full bg-[#3b2528] px-3 text-xs font-semibold text-[#ffb4ad]"}>{record.approved ? "Aprobó" : "No aprobó"}</span></td>
      <td className="px-4 py-3"><EnrollmentTypeBadge enrollmentType={record.enrollmentType} /></td>
      <td className="px-4 py-3"><span className="inline-flex h-8 items-center rounded-full bg-[#20262e] px-3 text-xs font-semibold text-[#b7c0cb]">{approvedModules}/4 módulos</span></td>
    </tr>
  );
}

function EnrollmentTypeBadge({ enrollmentType }: { enrollmentType: StudentModuleRecord["enrollmentType"] }) {
  return <span className={enrollmentType === "repeater" ? "inline-flex h-8 items-center rounded-full bg-[#3d321d] px-3 text-xs font-semibold text-[#ffd58a]" : enrollmentType === "new" ? "inline-flex h-8 items-center rounded-full bg-[#1d3040] px-3 text-xs font-semibold text-[#a9d8ff]" : "inline-flex h-8 items-center rounded-full bg-[#20262e] px-3 text-xs font-semibold text-[#b7c0cb]"}>{enrollmentTypeLabel(enrollmentType)}</span>;
}

function SortableTableHead({ children, sortKey, activeKey, direction, onSort }: { children: React.ReactNode; sortKey: SortKey; activeKey: SortKey; direction: SortDirection; onSort: (key: SortKey) => void }) {
  const active = sortKey === activeKey;
  return <th className="px-2 py-2 font-semibold"><button type="button" className="flex h-8 w-full items-center gap-1 rounded-sm px-2 text-left hover:bg-[#20262e] hover:text-[#fbf7ef]" onClick={() => onSort(sortKey)}>{children}<span aria-hidden className={active ? "text-[#5ee0c1]" : "text-[#59636f]"}>{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span></button></th>;
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-semibold">{children}</th>;
}

function Pagination({ page, totalPages, totalRecords, onPageChange }: { page: number; totalPages: number; totalRecords: number; onPageChange: (page: number) => void }) {
  const first = totalRecords === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, totalRecords);
  return (
    <div className="flex flex-col gap-3 border-t border-[#303741] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[#aab4c0]">Mostrando {first}–{last} de {totalRecords}</p>
      <div className="flex items-center gap-3">
        <button type="button" className="h-9 rounded-md border border-[#3b4652] px-3 text-[#dfe5eb] disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
        <span className="min-w-20 text-center text-[#b7c0cb]">{page} de {totalPages}</span>
        <button type="button" className="h-9 rounded-md border border-[#3b4652] px-3 text-[#dfe5eb] disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente</button>
      </div>
    </div>
  );
}

function getApprovalRate(summary: DashboardData["moduleSummaries"][number] | undefined): number | null {
  if (!summary?.enrollmentKnown || summary.enrolled === 0) return null;
  return Math.round((summary.approved / summary.enrolled) * 100);
}

function rateTone(rate: number | null): string {
  if (rate == null) return "border-[#3b4652] bg-[#20262e] text-[#b7c0cb] hover:border-[#7e8793]";
  if (rate >= 70) return "border-[#276b60] bg-[#123a36] text-[#9ff0db] hover:border-[#5ee0c1]";
  if (rate >= 50) return "border-[#315b78] bg-[#1d3040] text-[#a9d8ff] hover:border-[#76bfff]";
  if (rate >= 30) return "border-[#705a2c] bg-[#3d321d] text-[#ffd58a] hover:border-[#d8a13f]";
  return "border-[#713d42] bg-[#3b2528] text-[#ffb4ad] hover:border-[#df6b72]";
}

function approvalBarTone(rate: number): string {
  const color = rate >= 70 ? "bg-[#34b99b]" : rate >= 50 ? "bg-[#4ba3df]" : rate >= 30 ? "bg-[#d8a13f]" : "bg-[#df6b72]";
  return `h-full rounded-sm ${color}`;
}

function enrollmentTypeLabel(value: StudentModuleRecord["enrollmentType"]): string {
  return { new: "Nuevo", repeater: "Recursante", unknown: "Sin clasificar" }[value];
}

function issueFilterLabel(value: IssueFilter): string {
  return { pending: "Pendientes", reviewed: "Revisadas", resolved: "Resueltas", all: "Todas" }[value];
}

function csvCell(value: string | number): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function formatDni(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
