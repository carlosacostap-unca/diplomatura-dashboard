import { readFileSync } from "node:fs";
import path from "node:path";

const modules = [
  { id: 1, name: "Diseño Web", shortName: "Diseño" },
  { id: 2, name: "Programación con JavaScript", shortName: "JavaScript" },
  { id: 3, name: "Desarrollo backend con Node.js", shortName: "Backend" },
  { id: 4, name: "Desarrollo front-end con React", shortName: "React" },
];

const csvSources = [
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

const collections = {
  students: "students",
  modules: "academic_modules",
  graduations: "student_module_graduations",
};

const dataDirectory = path.join(process.cwd(), "data", "graduados");

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const env = readEnv();
  const pocketBaseUrl = env.NEXT_PUBLIC_POCKETBASE_URL?.replace(/\/$/, "");
  const email = env.POCKETBASE_ADMIN_EMAIL;
  const password = env.POCKETBASE_ADMIN_PASSWORD;

  if (!pocketBaseUrl || !email || !password) {
    throw new Error("Missing PocketBase environment variables in .env.local");
  }

  const token = await authenticate(pocketBaseUrl, email, password);
  await ensureCollections(pocketBaseUrl, token);

  const sourceRows = readCsvRecords();
  const moduleResult = await syncModules(pocketBaseUrl, token);
  const studentResult = await syncStudents(pocketBaseUrl, token, sourceRows);
  const graduationResult = await syncGraduations(
    pocketBaseUrl,
    token,
    sourceRows,
    studentResult.recordsByDni,
    moduleResult.recordsByNumber,
  );

  const verification = await verifyCounts(pocketBaseUrl, token);

  console.log(
    JSON.stringify(
      {
        sourceRows: sourceRows.length,
        modules: moduleResult.summary,
        students: studentResult.summary,
        graduations: graduationResult.summary,
        verification,
      },
      null,
      2,
    ),
  );
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

function readCsvRecords() {
  return csvSources.flatMap((source) => {
    const csv = readFileSync(path.join(dataDirectory, source.fileName), "utf8");

    return parseCsv(csv).map((row) => {
      const lastName = cleanCell(row["Apellido/s"]);
      const firstName = cleanCell(row["Nombre/s"]);
      const dni = cleanCell(row.DNI);

      return {
        cohort: source.cohort,
        module: source.module,
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
  });
}

async function syncModules(pocketBaseUrl, token) {
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
    );

    existingByNumber.set(moduleItem.id, saved);
  }

  return { recordsByNumber: existingByNumber, summary };
}

async function syncStudents(pocketBaseUrl, token, sourceRows) {
  const sourceByDni = new Map();

  for (const row of sourceRows) {
    if (!sourceByDni.has(row.dni)) {
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
    }
  }

  const existing = await getRecords(pocketBaseUrl, token, collections.students);
  const existingByDni = new Map(existing.map((record) => [record.dni, record]));
  const summary = createSummary();

  for (const student of sourceByDni.values()) {
    const saved = await upsertRecord(
      pocketBaseUrl,
      token,
      collections.students,
      existingByDni.get(student.dni),
      student,
      summary,
    );

    existingByDni.set(student.dni, saved);
  }

  return { recordsByDni: existingByDni, summary };
}

async function syncGraduations(
  pocketBaseUrl,
  token,
  sourceRows,
  studentsByDni,
  modulesByNumber,
) {
  const existing = await getRecords(
    pocketBaseUrl,
    token,
    collections.graduations,
  );
  const existingByKey = new Map(
    existing.map((record) => [record.uniqueKey, record]),
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
      student: student.id,
      module: moduleRecord.id,
      cohort: row.cohort,
      sourceFile: row.sourceFile,
    };

    const saved = await upsertRecord(
      pocketBaseUrl,
      token,
      collections.graduations,
      existingByKey.get(uniqueKey),
      nextRecord,
      summary,
    );

    existingByKey.set(uniqueKey, saved);
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
) {
  if (!existing) {
    const created = await writeRecord(
      pocketBaseUrl,
      token,
      collection,
      "POST",
      nextRecord,
    );
    summary.created += 1;
    return created;
  }

  if (hasChanges(existing, nextRecord)) {
    const updated = await writeRecord(
      pocketBaseUrl,
      token,
      collection,
      "PATCH",
      nextRecord,
      existing.id,
    );
    summary.updated += 1;
    return updated;
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

function createSummary() {
  return { created: 0, updated: 0, unchanged: 0 };
}

function parseCsv(csv) {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  const [headerLine, ...dataLines] = lines;
  const headers = splitCsvLine(headerLine).map(cleanCell);

  return dataLines.map((line) => {
    const values = splitCsvLine(line);

    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const values = [];
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

function cleanCell(value = "") {
  return value.trim().replace(/\s+/g, " ");
}
