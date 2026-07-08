import { readFileSync } from "node:fs";
import path from "node:path";

export type CohortId = 1 | 2 | 3 | 4 | 5 | 6;
export type ModuleId = 1 | 2 | 3 | 4;

export type GraduateRecord = {
  id: string;
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
  sourceFile: string;
};

export type ModuleSummary = {
  cohort: CohortId;
  module: ModuleId;
  count: number;
  sourceFile?: string;
};

export type DashboardData = {
  cohorts: CohortId[];
  modules: { id: ModuleId; name: string; shortName: string }[];
  records: GraduateRecord[];
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
  {
    cohort: 1,
    module: 1,
    fileName: "cohorte-1-modulo-1-diseno-web.csv",
  },
  {
    cohort: 1,
    module: 2,
    fileName: "cohorte-1-modulo-2-programacion-javascript.csv",
  },
  {
    cohort: 1,
    module: 3,
    fileName: "cohorte-1-modulo-3-backend-node.csv",
  },
];

const dataDirectory = path.join(process.cwd(), "data", "graduados");
const defaultPocketBaseUrl = "https://pocketbase-dashboard-diplomatura.epixum.com";
const graduationsCollection = "student_module_graduations";

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

type PocketBaseGraduationRecord = {
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
    console.error("Falling back to CSV graduate data", error);
    return readCsvRecords();
  });
  const moduleSummaries = buildModuleSummaries(records);

  return {
    cohorts,
    modules,
    records,
    moduleSummaries,
  };
}

function readCsvRecords(): GraduateRecord[] {
  const records = csvSources.flatMap((source) => readSource(source));

  return records;
}

async function readPocketBaseRecords(): Promise<GraduateRecord[]> {
  const pocketBaseUrl = (
    process.env.NEXT_PUBLIC_POCKETBASE_URL ?? defaultPocketBaseUrl
  ).replace(/\/$/, "");

  const records: GraduateRecord[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const response = await fetch(
      `${pocketBaseUrl}/api/collections/${graduationsCollection}/records?page=${page}&perPage=500&sort=cohort&expand=student,module`,
      { cache: "no-store" },
    );

    if (!response.ok) {
      throw new Error(`PocketBase read failed: ${response.status}`);
    }

    const payload = (await response.json()) as {
      items: PocketBaseGraduationRecord[];
      totalPages: number;
    };

    records.push(
      ...payload.items.map((record) => {
        const student = record.expand?.student;
        const moduleItem = record.expand?.module;

        if (!student || !moduleItem) {
          throw new Error("PocketBase relation expand is incomplete");
        }

        return {
          id: record.id,
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
          sourceFile: record.sourceFile,
        };
      }),
    );

    totalPages = payload.totalPages;
    page += 1;
  }

  return records;
}

function readSource(source: CsvSource): GraduateRecord[] {
  const filePath = path.join(dataDirectory, source.fileName);
  const csv = readFileSync(filePath, "utf8");
  const moduleName =
    modules.find((moduleItem) => moduleItem.id === source.module)?.name ?? "";

  return parseCsv(csv).map((row, index) => {
    const lastName = cleanCell(row["Apellido/s"]);
    const firstName = cleanCell(row["Nombre/s"]);
    const dni = normalizeDni(row.DNI);

    return {
      id: `${source.cohort}-${source.module}-${dni || index}`,
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
      phone: cleanCell(getCell(row, ["Número de teléfono", "Teléfono"])),
      email: cleanCell(getCell(row, ["E-mail", "Correo electrónico"])).toLowerCase(),
      sourceFile: source.fileName,
    };
  });
}

function buildModuleSummaries(records: GraduateRecord[]): ModuleSummary[] {
  const counts = new Map<string, ModuleSummary>();

  for (const record of records) {
    const key = `${record.cohort}-${record.module}`;
    const summary = counts.get(key);

    if (summary) {
      summary.count += 1;
      continue;
    }

    counts.set(key, {
      cohort: record.cohort,
      module: record.module,
      count: 1,
      sourceFile: record.sourceFile,
    });
  }

  return counts.values().toArray();
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
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
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

function toCohortId(value: number): CohortId {
  return value as CohortId;
}

function toModuleId(value: number): ModuleId {
  return value as ModuleId;
}
