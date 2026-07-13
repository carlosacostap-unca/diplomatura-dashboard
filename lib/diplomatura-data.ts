import { readFileSync } from "node:fs";
import path from "node:path";

export type CohortId = 1 | 2 | 3 | 4 | 5 | 6;
export type ModuleId = 1 | 2 | 3 | 4;

export type StudentModuleRecord = {
  id: string;
  studentId: string;
  cohort: CohortId;
  module: ModuleId;
  moduleName: string;
  lastName: string;
  firstName: string;
  fullName: string;
  dni: string;
  birthDate: string;
  gender: string;
  phone: string;
  email: string;
  approved: boolean;
  enrollmentKnown: boolean;
  sourceFile: string;
};

export type ModuleSummary = {
  cohort: CohortId;
  module: ModuleId;
  enrolled: number;
  approved: number;
  notApproved: number;
  enrollmentKnown: boolean;
};

export type DashboardData = {
  cohorts: CohortId[];
  modules: { id: ModuleId; name: string; shortName: string }[];
  records: StudentModuleRecord[];
  moduleSummaries: ModuleSummary[];
};

type CsvSource = {
  cohort: CohortId;
  module: ModuleId;
  fileName: string;
};

export const cohorts: CohortId[] = [1, 2, 3, 4, 5, 6];

export const modules: DashboardData["modules"] = [
  { id: 1, name: "Diseño Web", shortName: "Diseño" },
  { id: 2, name: "Programación con JavaScript", shortName: "JavaScript" },
  { id: 3, name: "Desarrollo backend con Node.js", shortName: "Backend" },
  { id: 4, name: "Desarrollo front-end con React", shortName: "React" },
];

const csvSources: CsvSource[] = [
  { cohort: 1, module: 1, fileName: "cohorte-1-modulo-1-diseno-web.csv" },
  {
    cohort: 1,
    module: 2,
    fileName: "cohorte-1-modulo-2-programacion-javascript.csv",
  },
  { cohort: 1, module: 3, fileName: "cohorte-1-modulo-3-backend-node.csv" },
];

const dataDirectory = path.join(process.cwd(), "data", "graduados");
const enrollmentDataDirectory = path.join(process.cwd(), "data", "inscriptos");
const defaultPocketBaseUrl =
  "https://pocketbase-dashboard-diplomatura.epixum.com";
const graduationsCollection = "student_module_graduations";
const enrollmentsCollection = "student_module_enrollments";

type PocketBaseStudentRecord = {
  id: string;
  dni: string;
  lastName: string;
  firstName: string;
  fullName: string;
  birthDate: string;
  gender: string;
  phone: string;
  email: string;
};

type PocketBaseModuleRecord = {
  id: string;
  number: number;
  name: string;
  shortName: string;
};

type PocketBaseAcademicRecord = {
  id: string;
  cohort: number;
  sourceFile: string;
  expand?: {
    student?: PocketBaseStudentRecord;
    module?: PocketBaseModuleRecord;
  };
};

export async function getDashboardData(): Promise<DashboardData> {
  const records = await readPocketBaseRecords().catch((error) => {
    console.error("Falling back to local academic data", error);
    return readLocalRecords();
  });

  return {
    cohorts,
    modules,
    records,
    moduleSummaries: buildModuleSummaries(records),
  };
}

async function readPocketBaseRecords(): Promise<StudentModuleRecord[]> {
  const pocketBaseUrl = (
    process.env.NEXT_PUBLIC_POCKETBASE_URL ?? defaultPocketBaseUrl
  ).replace(/\/$/, "");
  const [graduations, enrollments] = await Promise.all([
    readPocketBaseCollection(pocketBaseUrl, graduationsCollection),
    readPocketBaseCollection(pocketBaseUrl, enrollmentsCollection),
  ]);
  const graduationKeys = new Set(
    graduations.map((record) => relationKey(record)),
  );
  const enrollmentKeys = new Set(
    enrollments.map((record) => relationKey(record)),
  );
  const records = enrollments.map((record) =>
    mapPocketBaseRecord(record, graduationKeys.has(relationKey(record)), true),
  );

  records.push(
    ...graduations
      .filter((record) => !enrollmentKeys.has(relationKey(record)))
      .map((record) => mapPocketBaseRecord(record, true, false)),
  );

  return records;
}

async function readPocketBaseCollection(
  pocketBaseUrl: string,
  collection: string,
): Promise<PocketBaseAcademicRecord[]> {
  const records: PocketBaseAcademicRecord[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await fetch(
      `${pocketBaseUrl}/api/collections/${collection}/records?page=${page}&perPage=500&sort=cohort&expand=student,module`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`PocketBase ${collection} read failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      items: PocketBaseAcademicRecord[];
      totalPages: number;
    };
    records.push(...payload.items);
    totalPages = payload.totalPages;
    page += 1;
  }

  return records;
}

function mapPocketBaseRecord(
  record: PocketBaseAcademicRecord,
  approved: boolean,
  enrollmentKnown: boolean,
): StudentModuleRecord {
  const student = record.expand?.student;
  const moduleItem = record.expand?.module;

  if (!student || !moduleItem) {
    throw new Error("PocketBase relation expand is incomplete");
  }

  return {
    id: `${record.id}-${enrollmentKnown ? "enrollment" : "graduation"}`,
    studentId: student.id,
    cohort: toCohortId(record.cohort),
    module: toModuleId(moduleItem.number),
    moduleName: moduleItem.name,
    lastName: student.lastName,
    firstName: student.firstName,
    fullName: student.fullName,
    dni: student.dni,
    birthDate: student.birthDate,
    gender: student.gender,
    phone: student.phone,
    email: student.email,
    approved,
    enrollmentKnown,
    sourceFile: record.sourceFile,
  };
}

function relationKey(record: PocketBaseAcademicRecord): string {
  const student = record.expand?.student;
  const moduleItem = record.expand?.module;

  if (!student || !moduleItem) {
    throw new Error("PocketBase relation expand is incomplete");
  }

  return `${student.id}-${record.cohort}-${moduleItem.number}`;
}

function readLocalRecords(): StudentModuleRecord[] {
  const graduates = csvSources.flatMap((source) => readGraduateSource(source));
  const enrollmentPath = path.join(
    enrollmentDataDirectory,
    "cohorte-1-modulo-1-diseno-web.csv",
  );
  const enrollments = readEnrollmentSource(enrollmentPath, graduates);
  const derivedModuleTwoEnrollments = deriveNextModuleEnrollments(
    graduates,
    1,
    1,
    2,
  );
  const coveredRelations = new Set(
    [...enrollments, ...derivedModuleTwoEnrollments].map(
      (record) => `${record.studentId}-${record.cohort}-${record.module}`,
    ),
  );

  return [
    ...enrollments,
    ...derivedModuleTwoEnrollments,
    ...graduates.filter(
      (record) =>
        !coveredRelations.has(
          `${record.studentId}-${record.cohort}-${record.module}`,
        ),
    ),
  ];
}

function deriveNextModuleEnrollments(
  graduates: StudentModuleRecord[],
  cohort: CohortId,
  sourceModule: ModuleId,
  targetModule: ModuleId,
): StudentModuleRecord[] {
  const targetApprovedStudentIds = new Set(
    graduates
      .filter(
        (record) =>
          record.cohort === cohort && record.module === targetModule,
      )
      .map((record) => record.studentId),
  );
  const targetModuleName =
    modules.find((moduleItem) => moduleItem.id === targetModule)?.name ?? "";

  return graduates
    .filter(
      (record) =>
        record.cohort === cohort && record.module === sourceModule,
    )
    .map((record) => ({
      ...record,
      id: `derived-enrollment-${cohort}-${targetModule}-${record.studentId}`,
      module: targetModule,
      moduleName: targetModuleName,
      approved: targetApprovedStudentIds.has(record.studentId),
      enrollmentKnown: true,
      sourceFile: `derived:cohort-${cohort}-module-${sourceModule}-graduates`,
    }));
}

function readGraduateSource(source: CsvSource): StudentModuleRecord[] {
  const filePath = path.join(dataDirectory, source.fileName);
  const csv = readFileSync(filePath, "utf8");
  const moduleName =
    modules.find((moduleItem) => moduleItem.id === source.module)?.name ?? "";

  return parseCsv(csv).map((row, index) => {
    const lastName = cleanCell(row["Apellido/s"]);
    const firstName = cleanCell(row["Nombre/s"]);
    const dni = normalizeDni(row.DNI);

    return {
      id: `graduation-${source.cohort}-${source.module}-${dni || index}`,
      studentId: `dni:${dni || `${source.cohort}-${source.module}-${index}`}`,
      cohort: source.cohort,
      module: source.module,
      moduleName,
      lastName,
      firstName,
      fullName: `${lastName}, ${firstName}`,
      dni,
      birthDate: cleanCell(
        getCell(row, ["Fecha de nacimiento", "Fecha de Nacimiento"]),
      ),
      gender: cleanCell(getCell(row, ["Género"])),
      phone: normalizePhone(
        getCell(row, ["Número de teléfono", "Teléfono"]),
      ),
      email: cleanCell(
        getCell(row, ["E-mail", "Correo electrónico"]),
      ).toLowerCase(),
      approved: true,
      enrollmentKnown: false,
      sourceFile: source.fileName,
    };
  });
}

function readEnrollmentSource(
  filePath: string,
  graduates: StudentModuleRecord[],
): StudentModuleRecord[] {
  const rows = parseCsv(readFileSync(filePath, "utf8"));
  const cohortGraduates = graduates.filter(
    (record) => record.cohort === 1 && record.module === 1,
  );
  const byEmail = new Map(cohortGraduates.map((record) => [record.email, record]));
  const byPhoneAndName = new Map(
    cohortGraduates.map((record) => [
      `${record.phone}|${normalizeName(record.lastName, record.firstName)}`,
      record,
    ]),
  );

  return rows.map((row, index) => {
    const lastName = cleanCell(row["Apellido/s"]);
    const firstName = cleanCell(row["Nombre/s"]);
    const email = cleanCell(row["Correo electrónico"]).toLowerCase();
    const phone = normalizePhone(row["Teléfono"]);
    const graduate =
      byEmail.get(email) ??
      byPhoneAndName.get(`${phone}|${normalizeName(lastName, firstName)}`);

    return {
      id: `enrollment-1-1-${index}`,
      studentId: graduate?.studentId ?? `email:${email}`,
      cohort: 1,
      module: 1,
      moduleName: modules[0].name,
      lastName: graduate?.lastName ?? lastName,
      firstName: graduate?.firstName ?? firstName,
      fullName: graduate?.fullName ?? `${lastName}, ${firstName}`,
      dni: graduate?.dni ?? "",
      birthDate: graduate?.birthDate ?? "",
      gender: graduate?.gender ?? "",
      phone: graduate?.phone ?? phone,
      email: graduate?.email ?? email,
      approved: Boolean(graduate),
      enrollmentKnown: true,
      sourceFile: path.basename(filePath),
    };
  });
}

function buildModuleSummaries(
  records: StudentModuleRecord[],
): ModuleSummary[] {
  const summaries = new Map<string, ModuleSummary>();

  for (const record of records) {
    const key = `${record.cohort}-${record.module}`;
    const summary = summaries.get(key) ?? {
      cohort: record.cohort,
      module: record.module,
      enrolled: 0,
      approved: 0,
      notApproved: 0,
      enrollmentKnown: false,
    };

    summary.enrolled += 1;
    summary.approved += record.approved ? 1 : 0;
    summary.notApproved += record.approved ? 0 : 1;
    summary.enrollmentKnown ||= record.enrollmentKnown;
    summaries.set(key, summary);
  }

  return Array.from(summaries.values());
}

function parseCsv(csv: string): Record<string, string>[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  const [headerLine, ...dataLines] = lines;
  const headers = splitCsvLine(headerLine).map(cleanCell);

  return dataLines.map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function cleanCell(value = ""): string {
  return value.trim().replace(/\s+/g, " ");
}

function getCell(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    if (row[name] != null) {
      return row[name];
    }
  }
  return "";
}

function normalizeDni(value = ""): string {
  return cleanCell(value).replace(/\D/g, "");
}

function normalizePhone(value = ""): string {
  return cleanCell(value).replace(/\D/g, "");
}

function normalizeName(lastName: string, firstName: string): string {
  return `${lastName} ${firstName}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toCohortId(value: number): CohortId {
  return value as CohortId;
}

function toModuleId(value: number): ModuleId {
  return value as ModuleId;
}
