import { readFileSync } from "node:fs";
import path from "node:path";
import readXlsxFile from "read-excel-file/node";

const modules = [
  { id: 1, name: "Diseño Web", shortName: "Diseño" },
  { id: 2, name: "Programación con JavaScript", shortName: "JavaScript" },
  { id: 3, name: "Desarrollo backend con Node.js", shortName: "Backend" },
  { id: 4, name: "Desarrollo front-end con React", shortName: "React" },
];

const collections = {
  students: "students",
  modules: "academic_modules",
  graduations: "student_module_graduations",
};

const defaultWorkbookPath = path.join(
  process.cwd(),
  "data",
  "graduados",
  "egresados-diplomatura-fullstack-javascript.xlsx",
);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = readEnv();
  const pocketBaseUrl = env.NEXT_PUBLIC_POCKETBASE_URL?.replace(/\/$/, "");
  const email = env.POCKETBASE_ADMIN_EMAIL;
  const password = env.POCKETBASE_ADMIN_PASSWORD;

  if (!pocketBaseUrl || !email || !password) {
    throw new Error("Missing PocketBase environment variables in .env.local");
  }

  const sourceRows = await readWorkbookRecords(options.source);
  const sourceValidation = validateSourceRows(sourceRows);
  const token = await authenticate(pocketBaseUrl, email, password);

  if (options.apply) {
    await ensureCollections(pocketBaseUrl, token);
  }

  const moduleResult = await syncModules(pocketBaseUrl, token, options.apply);
  const studentResult = await syncStudents(
    pocketBaseUrl,
    token,
    sourceRows,
    options.apply,
  );
  const graduationResult = await syncGraduations(
    pocketBaseUrl,
    token,
    sourceRows,
    studentResult.recordsByDni,
    moduleResult.recordsByNumber,
    options.apply,
  );
  const verification = await verifyCounts(pocketBaseUrl, token);

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        source: {
          workbook: path.relative(process.cwd(), options.source),
          rows: sourceRows.length,
          uniqueStudents: new Set(sourceRows.map((row) => row.dni)).size,
          byCohortModule: countByCohortModule(sourceRows),
          warnings: sourceValidation.warnings,
        },
        modules: moduleResult.summary,
        students: studentResult.summary,
        graduations: graduationResult.summary,
        pocketBaseBeforeOrAfter: verification,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  const options = {
    apply: false,
    source: defaultWorkbookPath,
  };

  for (const arg of args) {
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }

    if (arg.startsWith("--source=")) {
      options.source = path.resolve(arg.slice("--source=".length));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readEnv() {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

async function authenticate(pocketBaseUrl, email, password) {
  const response = await fetch(
    `${pocketBaseUrl}/api/collections/_superusers/auth-with-password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: email, password }),
    },
  );
  const payload = await response.json();

  if (!response.ok || !payload.token) {
    throw new Error(`PocketBase auth failed: ${response.status}`);
  }

  return payload.token;
}

async function readWorkbookRecords(workbookPath) {
  const sheets = await readXlsxFile(workbookPath);
  const records = [];

  for (const sheet of sheets
    .map((sheetItem) => ({ ...sheetItem, meta: parseSheetName(sheetItem.sheet) }))
    .filter((sheetItem) => sheetItem.meta)
    .sort(
      (first, second) =>
        first.meta.cohort - second.meta.cohort ||
        first.meta.module - second.meta.module ||
        first.sheet.localeCompare(second.sheet, "es"),
    )) {
    const headerIndex = sheet.data.findIndex((row) =>
      row.some((cell) => normalizeHeader(cell) === "dni"),
    );

    if (headerIndex < 0) {
      continue;
    }

    const headers = sheet.data[headerIndex].map(normalizeHeader);
    const columnMap = {
      lastName: findColumn(headers, [
        "apellido/s",
        "apellidos",
        "apellido",
        "alumno/s",
        "alumnos",
      ]),
      firstName: findColumn(headers, ["nombre/s", "nombres", "nombre"]),
      dni: findColumn(headers, ["dni"]),
      birthDate: findColumn(headers, [
        "fecha de nacimiento",
        "fecha nacimiento",
      ]),
      gender: findColumn(headers, ["género", "genero"]),
      email: findColumn(headers, ["e-mail", "correo electrónico", "email"]),
      phone: findColumn(headers, [
        "número de teléfono",
        "numero de teléfono",
        "número de telefono",
        "numero de telefono",
        "teléfono",
        "telefono",
      ]),
    };

    if (
      columnMap.lastName == null ||
      columnMap.firstName == null ||
      columnMap.dni == null
    ) {
      throw new Error(`Missing required columns in sheet ${sheet.sheet}`);
    }

    for (const row of sheet.data.slice(headerIndex + 1)) {
      const dni = normalizeDni(getByIndex(row, columnMap.dni));

      if (!dni) {
        continue;
      }

      const lastName = cleanCell(getByIndex(row, columnMap.lastName));
      const firstName = cleanCell(getByIndex(row, columnMap.firstName));

      records.push({
        cohort: sheet.meta.cohort,
        module: sheet.meta.module,
        lastName,
        firstName,
        fullName: `${lastName}, ${firstName}`,
        dni,
        birthDate: formatDateCell(getByIndex(row, columnMap.birthDate)),
        gender: cleanCell(getByIndex(row, columnMap.gender)),
        phone: normalizePhone(getByIndex(row, columnMap.phone)),
        email: cleanCell(getByIndex(row, columnMap.email)).toLowerCase(),
        sourceFile: `${path.basename(workbookPath)}#${sheet.sheet}`,
      });
    }
  }

  return records;
}

function parseSheetName(sheetName) {
  const match = sheetName.match(/Cohorte\s*(\d+).*?M[óo]dulo\s*(\d+)/i);

  if (!match) {
    return null;
  }

  return {
    cohort: Number(match[1]),
    module: Number(match[2]),
  };
}

function findColumn(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(normalizeHeader(name));

    if (index >= 0) {
      return index;
    }
  }

  return null;
}

function getByIndex(row, index) {
  return index == null ? "" : row[index];
}

function validateSourceRows(sourceRows) {
  const warnings = [];
  const byGraduation = new Map();
  const byStudent = new Map();

  for (const row of sourceRows) {
    const graduationKey = `${row.cohort}-${row.module}-${row.dni}`;
    byGraduation.set(graduationKey, (byGraduation.get(graduationKey) ?? 0) + 1);
    byStudent.set(row.dni, (byStudent.get(row.dni) ?? 0) + 1);
  }

  const duplicateGraduations = Array.from(byGraduation.entries()).filter(
    ([, count]) => count > 1,
  );

  if (duplicateGraduations.length > 0) {
    warnings.push({
      type: "duplicate_graduations",
      count: duplicateGraduations.length,
      examples: duplicateGraduations.slice(0, 5).map(([key]) => key),
    });
  }

  return { warnings };
}

async function ensureCollections(pocketBaseUrl, token) {
  const existing = await listCollections(pocketBaseUrl, token);
  const byName = new Map(existing.map((collection) => [collection.name, collection]));

  if (!byName.has(collections.students)) {
    await createCollection(pocketBaseUrl, token, {
      name: collections.students,
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "dni", type: "text", required: true },
        { name: "lastName", type: "text", required: true },
        { name: "firstName", type: "text", required: true },
        { name: "fullName", type: "text", required: true },
        { name: "birthDate", type: "text", required: false },
        { name: "gender", type: "text", required: false },
        { name: "phone", type: "text", required: false },
        { name: "email", type: "email", required: false },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${collections.students}_dni ON ${collections.students} (dni)`,
        `CREATE INDEX idx_${collections.students}_last_name ON ${collections.students} (lastName, firstName)`,
      ],
    });
  }

  if (!byName.has(collections.modules)) {
    await createCollection(pocketBaseUrl, token, {
      name: collections.modules,
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "number", type: "number", required: true },
        { name: "name", type: "text", required: true },
        { name: "shortName", type: "text", required: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${collections.modules}_number ON ${collections.modules} (number)`,
      ],
    });
  }

  const refreshed = await listCollections(pocketBaseUrl, token);
  const refreshedByName = new Map(
    refreshed.map((collection) => [collection.name, collection]),
  );
  const studentsCollection = refreshedByName.get(collections.students);
  const modulesCollection = refreshedByName.get(collections.modules);

  if (!studentsCollection || !modulesCollection) {
    throw new Error("Missing required collections after schema setup");
  }

  if (!refreshedByName.has(collections.graduations)) {
    await createCollection(pocketBaseUrl, token, {
      name: collections.graduations,
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "uniqueKey", type: "text", required: true },
        {
          name: "student",
          type: "relation",
          required: true,
          collectionId: studentsCollection.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1,
          displayFields: ["fullName", "dni"],
        },
        {
          name: "module",
          type: "relation",
          required: true,
          collectionId: modulesCollection.id,
          cascadeDelete: false,
          minSelect: 1,
          maxSelect: 1,
          displayFields: ["number", "name"],
        },
        { name: "cohort", type: "number", required: true },
        { name: "sourceFile", type: "text", required: true },
      ],
      indexes: [
        `CREATE UNIQUE INDEX idx_${collections.graduations}_unique_key ON ${collections.graduations} (uniqueKey)`,
        `CREATE INDEX idx_${collections.graduations}_cohort ON ${collections.graduations} (cohort)`,
      ],
    });
  }
}

async function listCollections(pocketBaseUrl, token) {
  const response = await fetch(`${pocketBaseUrl}/api/collections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Failed to list collections: ${response.status}`);
  }

  return payload.items;
}

async function createCollection(pocketBaseUrl, token, schema) {
  const response = await fetch(`${pocketBaseUrl}/api/collections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(schema),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to create collection ${schema.name}: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
}

async function syncModules(pocketBaseUrl, token, apply) {
  const existing = await getRecords(pocketBaseUrl, token, collections.modules);
  const existingByNumber = new Map(
    existing.map((record) => [Number(record.number), record]),
  );
  const summary = createSummary();

  for (const moduleItem of modules) {
    const existingRecord = existingByNumber.get(moduleItem.id);
    const nextRecord = {
      number: moduleItem.id,
      name: moduleItem.name,
      shortName: moduleItem.shortName,
    };

    const saved = await upsertRecord(
      pocketBaseUrl,
      token,
      collections.modules,
      existingRecord,
      nextRecord,
      summary,
      apply,
    );

    existingByNumber.set(moduleItem.id, saved);
  }

  return { recordsByNumber: existingByNumber, summary };
}

async function syncStudents(pocketBaseUrl, token, sourceRows, apply) {
  const sourceByDni = new Map();

  for (const row of sourceRows) {
    const existing = sourceByDni.get(row.dni);

    if (!existing) {
      sourceByDni.set(row.dni, {
        dni: row.dni,
        lastName: row.lastName,
        firstName: row.firstName,
        fullName: row.fullName,
        birthDate: row.birthDate,
        gender: row.gender,
        phone: row.phone,
        email: row.email,
      });
      continue;
    }

    sourceByDni.set(row.dni, mergeStudent(existing, row));
  }

  const existing = await getRecords(pocketBaseUrl, token, collections.students);
  const existingByDni = new Map(
    existing.map((record) => [normalizeDni(record.dni), record]),
  );
  const summary = createSummary();

  for (const student of sourceByDni.values()) {
    const saved = await upsertRecord(
      pocketBaseUrl,
      token,
      collections.students,
      existingByDni.get(normalizeDni(student.dni)),
      student,
      summary,
      apply,
    );

    existingByDni.set(normalizeDni(student.dni), saved);
  }

  return { recordsByDni: existingByDni, summary };
}

function mergeStudent(existing, nextRow) {
  return {
    dni: existing.dni,
    lastName: existing.lastName || nextRow.lastName,
    firstName: existing.firstName || nextRow.firstName,
    fullName: existing.fullName || nextRow.fullName,
    birthDate: existing.birthDate || nextRow.birthDate,
    gender: existing.gender || nextRow.gender,
    phone: existing.phone || nextRow.phone,
    email: existing.email || nextRow.email,
  };
}

async function syncGraduations(
  pocketBaseUrl,
  token,
  sourceRows,
  studentsByDni,
  modulesByNumber,
  apply,
) {
  const existing = await getRecords(
    pocketBaseUrl,
    token,
    collections.graduations,
  );
  const existingByKey = new Map(
    existing.map((record) => [normalizeGraduationKey(record.uniqueKey), record]),
  );
  const summary = createSummary();

  for (const row of sourceRows) {
    const student = studentsByDni.get(row.dni);
    const moduleRecord = modulesByNumber.get(row.module);

    if (!student || !moduleRecord) {
      throw new Error(`Missing relation for ${row.dni} module ${row.module}`);
    }

    const uniqueKey = `${row.cohort}-${row.module}-${row.dni}`;
    const nextRecord = {
      uniqueKey,
      student: student.id ?? `dry-run-student-${row.dni}`,
      module: moduleRecord.id ?? `dry-run-module-${row.module}`,
      cohort: row.cohort,
      sourceFile: row.sourceFile,
    };

    const saved = await upsertRecord(
      pocketBaseUrl,
      token,
      collections.graduations,
      existingByKey.get(normalizeGraduationKey(uniqueKey)),
      nextRecord,
      summary,
      apply,
    );

    existingByKey.set(normalizeGraduationKey(uniqueKey), saved);
  }

  return { recordsByKey: existingByKey, summary };
}

async function getRecords(pocketBaseUrl, token, collection, query = "") {
  const records = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const separator = query ? "&" : "";
    const response = await fetch(
      `${pocketBaseUrl}/api/collections/${collection}/records?page=${page}&perPage=500${separator}${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(`Failed to read ${collection}: ${response.status}`);
    }

    records.push(...payload.items);
    totalPages = payload.totalPages;
    page += 1;
  }

  return records;
}

async function upsertRecord(
  pocketBaseUrl,
  token,
  collection,
  existing,
  nextRecord,
  summary,
  apply,
) {
  if (!existing) {
    summary.created += 1;

    if (!apply) {
      return { id: `dry-run-${collection}-${summary.created}`, ...nextRecord };
    }

    return writeRecord(pocketBaseUrl, token, collection, "POST", nextRecord);
  }

  if (hasChanges(existing, nextRecord)) {
    summary.updated += 1;

    if (!apply) {
      return { ...existing, ...nextRecord };
    }

    return writeRecord(
      pocketBaseUrl,
      token,
      collection,
      "PATCH",
      nextRecord,
      existing.id,
    );
  }

  summary.unchanged += 1;
  return existing;
}

async function writeRecord(
  pocketBaseUrl,
  token,
  collection,
  method,
  record,
  id,
) {
  const target = id
    ? `${pocketBaseUrl}/api/collections/${collection}/records/${id}`
    : `${pocketBaseUrl}/api/collections/${collection}/records`;
  const response = await fetch(target, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(record),
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Failed to write ${collection}: ${response.status} ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

function hasChanges(existing, nextRecord) {
  return Object.entries(nextRecord).some(
    ([key, value]) => String(existing[key] ?? "") !== String(value ?? ""),
  );
}

async function verifyCounts(pocketBaseUrl, token) {
  const [students, academicModules, graduations] = await Promise.all([
    getRecords(pocketBaseUrl, token, collections.students),
    getRecords(pocketBaseUrl, token, collections.modules),
    getRecords(
      pocketBaseUrl,
      token,
      collections.graduations,
      "expand=student,module&sort=cohort",
    ),
  ]);

  return {
    students: students.length,
    modules: academicModules.length,
    graduations: graduations.length,
    byCohortModule: graduations.reduce((summary, record) => {
      const moduleNumber = record.expand?.module?.number ?? "?";
      const key = `cohorte-${record.cohort}-modulo-${moduleNumber}`;
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {}),
  };
}

function countByCohortModule(records) {
  return records.reduce((summary, record) => {
    const key = `cohorte-${record.cohort}-modulo-${record.module}`;
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
}

function createSummary() {
  return { created: 0, updated: 0, unchanged: 0 };
}

function normalizeHeader(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function cleanCell(value = "") {
  if (value == null) {
    return "";
  }

  if (value instanceof Date) {
    return formatDateCell(value);
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }

  return String(value).trim().replace(/\s+/g, " ");
}

function formatDateCell(value = "") {
  if (!value) {
    return "";
  }

  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const year = value.getUTCFullYear();
    return `${day}/${month}/${year}`;
  }

  return cleanCell(value);
}

function normalizePhone(value = "") {
  return cleanCell(value).replace(/\D/g, "");
}

function normalizeDni(value = "") {
  return cleanCell(value).replace(/\D/g, "");
}

function normalizeGraduationKey(value = "") {
  const [cohort, module, dni] = String(value).split("-");

  return `${cohort}-${module}-${normalizeDni(dni)}`;
}
