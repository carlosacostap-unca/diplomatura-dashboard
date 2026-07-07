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
];

const dataDirectory = path.join(process.cwd(), "data", "graduados");

export function getDashboardData(): DashboardData {
  const records = csvSources.flatMap((source) => readSource(source));
  const moduleSummaries = buildModuleSummaries(records);

  return {
    cohorts,
    modules,
    records,
    moduleSummaries,
  };
}

function readSource(source: CsvSource): GraduateRecord[] {
  const filePath = path.join(dataDirectory, source.fileName);
  const csv = readFileSync(filePath, "utf8");
  const moduleName =
    modules.find((moduleItem) => moduleItem.id === source.module)?.name ?? "";

  return parseCsv(csv).map((row, index) => {
    const lastName = cleanCell(row["Apellido/s"]);
    const firstName = cleanCell(row["Nombre/s"]);
    const dni = cleanCell(row.DNI);

    return {
      id: `${source.cohort}-${source.module}-${dni || index}`,
      cohort: source.cohort,
      module: source.module,
      moduleName,
      lastName,
      firstName,
      fullName: `${lastName}, ${firstName}`,
      dni,
      birthDate: cleanCell(row["Fecha de nacimiento"]),
      gender: cleanCell(row["Género"]),
      phone: cleanCell(row["Número de teléfono"]),
      email: cleanCell(row["E-mail"]).toLowerCase(),
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
