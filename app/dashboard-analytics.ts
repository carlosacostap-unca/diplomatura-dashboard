import type {
  CohortId,
  DashboardData,
  ModuleId,
  StudentModuleRecord,
} from "@/lib/diplomatura-data";

export type RetentionPoint = {
  module: ModuleId;
  enrolled: number;
  percentage: number;
};

export type CohortPerformance = {
  cohort: CohortId;
  modules: {
    module: ModuleId;
    enrolled: number;
    approved: number;
    enrollmentKnown: boolean;
    rate: number;
  }[];
};

export type EnrollmentMix = {
  cohort: CohortId;
  newStudents: number;
  repeaters: number;
  total: number;
};

export type DataQualityIssueKind =
  | "missing-dni"
  | "missing-email"
  | "missing-phone"
  | "unknown-enrollment"
  | "missing-enrollment";

export type DataQualityIssue = {
  id: string;
  kind: DataQualityIssueKind;
  studentId: string;
  studentName: string;
  title: string;
  detail: string;
};

export type DashboardAnalytics = {
  graduates: number;
  withProgress: number;
  withoutApprovals: number;
  repeaters: number;
  retention: RetentionPoint[];
  cohortPerformance: CohortPerformance[];
  enrollmentMix: EnrollmentMix[];
  issues: DataQualityIssue[];
};

export function buildDashboardAnalytics(
  data: DashboardData,
  selectedCohort: "all" | string,
): DashboardAnalytics {
  const approvedModules = new Map<string, Set<ModuleId>>();
  const repeaters = new Set<string>();

  for (const record of data.records) {
    const modules = approvedModules.get(record.studentId) ?? new Set<ModuleId>();
    if (record.approved) modules.add(record.module);
    approvedModules.set(record.studentId, modules);
    if (record.enrollmentType === "repeater") repeaters.add(record.studentId);
  }

  const progress = Array.from(approvedModules.values(), (modules) => modules.size);

  return {
    graduates: progress.filter((count) => count === 4).length,
    withProgress: progress.filter((count) => count > 0 && count < 4).length,
    withoutApprovals: progress.filter((count) => count === 0).length,
    repeaters: repeaters.size,
    retention: buildRetention(data, selectedCohort),
    cohortPerformance: buildCohortPerformance(data),
    enrollmentMix: buildEnrollmentMix(data),
    issues: buildDataQualityIssues(data.records),
  };
}

function buildRetention(
  data: DashboardData,
  selectedCohort: "all" | string,
): RetentionPoint[] {
  const cohort = selectedCohort === "all" ? null : Number(selectedCohort);
  const totals = data.modules.map((moduleItem) => {
    const enrolled = data.moduleSummaries
      .filter(
        (summary) =>
          summary.module === moduleItem.id &&
          summary.enrollmentKnown &&
          (cohort == null || summary.cohort === cohort),
      )
      .reduce((sum, summary) => sum + summary.enrolled, 0);

    return { module: moduleItem.id, enrolled };
  });
  const baseline = totals[0]?.enrolled ?? 0;

  return totals.map((point) => ({
    ...point,
    percentage:
      baseline > 0 ? Math.round((point.enrolled / baseline) * 100) : 0,
  }));
}

function buildCohortPerformance(data: DashboardData): CohortPerformance[] {
  return data.cohorts.map((cohort) => ({
    cohort,
    modules: data.modules.map((moduleItem) => {
      const summary = data.moduleSummaries.find(
        (item) => item.cohort === cohort && item.module === moduleItem.id,
      );
      const enrolled = summary?.enrolled ?? 0;
      const approved = summary?.approved ?? 0;
      const enrollmentKnown = summary?.enrollmentKnown ?? false;

      return {
        module: moduleItem.id,
        enrolled,
        approved,
        enrollmentKnown,
        rate:
          enrollmentKnown && enrolled > 0
            ? Math.round((approved / enrolled) * 100)
            : 0,
      };
    }),
  }));
}

function buildEnrollmentMix(data: DashboardData): EnrollmentMix[] {
  return data.cohorts.map((cohort) => {
    const records = data.records.filter(
      (record) => record.cohort === cohort && record.enrollmentKnown,
    );
    const newStudents = records.filter(
      (record) => record.enrollmentType === "new",
    ).length;
    const repeaters = records.filter(
      (record) => record.enrollmentType === "repeater",
    ).length;

    return {
      cohort,
      newStudents,
      repeaters,
      total: newStudents + repeaters,
    };
  });
}

function buildDataQualityIssues(
  records: StudentModuleRecord[],
): DataQualityIssue[] {
  const issues = new Map<string, DataQualityIssue>();
  const students = new Map<string, StudentModuleRecord>();

  for (const record of records) {
    students.set(record.studentId, students.get(record.studentId) ?? record);

    if (record.enrollmentKnown && record.enrollmentType === "unknown") {
      addIssue(issues, {
        id: `${record.studentId}-${record.cohort}-${record.module}-unknown-enrollment`,
        kind: "unknown-enrollment",
        studentId: record.studentId,
        studentName: record.fullName,
        title: "Inscripcion sin clasificar",
        detail: `Cohorte ${record.cohort}, modulo ${record.module}`,
      });
    }

    if (!record.enrollmentKnown) {
      addIssue(issues, {
        id: `${record.studentId}-${record.cohort}-${record.module}-missing-enrollment`,
        kind: "missing-enrollment",
        studentId: record.studentId,
        studentName: record.fullName,
        title: "Aprobacion sin inscripcion registrada",
        detail: `Cohorte ${record.cohort}, modulo ${record.module}`,
      });
    }
  }

  for (const student of students.values()) {
    if (!student.dni) {
      addStudentIssue(issues, student, "missing-dni", "DNI faltante");
    }
    if (!student.email) {
      addStudentIssue(issues, student, "missing-email", "Correo faltante");
    }
    if (!student.phone) {
      addStudentIssue(issues, student, "missing-phone", "Telefono faltante");
    }
  }

  return Array.from(issues.values()).sort((first, second) =>
    first.studentName.localeCompare(second.studentName, "es"),
  );
}

function addStudentIssue(
  issues: Map<string, DataQualityIssue>,
  student: StudentModuleRecord,
  kind: "missing-dni" | "missing-email" | "missing-phone",
  title: string,
) {
  addIssue(issues, {
    id: `${student.studentId}-${kind}`,
    kind,
    studentId: student.studentId,
    studentName: student.fullName,
    title,
    detail: "Dato personal pendiente de completar",
  });
}

function addIssue(
  issues: Map<string, DataQualityIssue>,
  issue: DataQualityIssue,
) {
  issues.set(issue.id, issue);
}
