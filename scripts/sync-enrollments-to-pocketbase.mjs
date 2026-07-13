import { readFileSync } from "node:fs";
import path from "node:path";

const cohort = 1;
const moduleNumber = 1;
const sourceFile = "cohorte-1-modulo-1-diseno-web.csv";
const defaultSourcePath = path.join(
  process.cwd(),
  "data",
  "inscriptos",
  sourceFile,
);

const collections = {
  students: "students",
  modules: "academic_modules",
  graduations: "student_module_graduations",
  enrollments: "student_module_enrollments",
};

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

  const sourceRows = readCsvRecords(options.source);
  validateSourceRows(sourceRows);

  const token = await authenticate(pocketBaseUrl, email, password);
  const [studentCollection, students, modules, graduations] = await Promise.all([
    getCollection(pocketBaseUrl, token, collections.students),
    getRecords(pocketBaseUrl, token, collections.students),
    getRecords(pocketBaseUrl, token, collections.modules),
    getRecords(
      pocketBaseUrl,
      token,
      collections.graduations,
      `filter=${encodeURIComponent(
        `cohort = ${cohort}`,
      )}&expand=student,module`,
    ),
  ]);

  const moduleRecord = modules.find(
    (item) => Number(item.number) === moduleNumber,
  );

  if (!moduleRecord) {
    throw new Error(`Module ${moduleNumber} is missing in PocketBase`);
  }

  const moduleGraduations = graduations.filter(
    (item) => Number(item.expand?.module?.number) === moduleNumber,
  );
  const reconciliation = reconcileRows(
    sourceRows,
    students,
    moduleGraduations,
  );

  const schemaSummary = {
    studentIdentityFieldAdded: !studentCollection.fields.some(
      (field) => field.name === "identityKey",
    ),
    enrollmentCollectionAdded: false,
  };

  if (options.apply) {
    await prepareStudentSchema(
      pocketBaseUrl,
      token,
      studentCollection,
      students,
    );
  }

  const studentResult = await syncStudents(
    pocketBaseUrl,
    token,
    sourceRows,
    students,
    reconciliation.studentByRow,
    options.apply,
  );

  let enrollmentCollection = await findCollection(
    pocketBaseUrl,
    token,
    collections.enrollments,
  );

  if (!enrollmentCollection && options.apply) {
    enrollmentCollection = await createEnrollmentCollection(
      pocketBaseUrl,
      token,
      studentCollection.id,
      moduleRecord.collectionId,
    );
    schemaSummary.enrollmentCollectionAdded = true;
  }

  const existingEnrollments = enrollmentCollection
    ? await getRecords(pocketBaseUrl, token, collections.enrollments)
    : [];
  const enrollmentResult = await syncEnrollments(
    pocketBaseUrl,
    token,
    sourceRows,
    studentResult.studentByRow,
    moduleRecord,
    existingEnrollments,
    options.apply,
  );

  if (options.apply) {
    await requireStudentIdentityKey(pocketBaseUrl, token);
  }

  const verification = options.apply
    ? await verifyImport(pocketBaseUrl, token, moduleRecord.id)
    : null;

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        source: {
          file: path.relative(process.cwd(), options.source),
          rows: sourceRows.length,
          duplicateEmails: countDuplicates(sourceRows, (row) => row.email),
          duplicatePhones: countDuplicates(sourceRows, (row) => row.phone),
        },
        reconciliation: {
          approved: reconciliation.approvedRows.size,
          notApproved: sourceRows.length - reconciliation.approvedRows.size,
          approvedByEmail: reconciliation.approvedByEmail,
          approvedByPhoneAndName: reconciliation.approvedByPhoneAndName,
          existingStudentsReused: reconciliation.studentByRow.size,
        },
        schema: schemaSummary,
        students: studentResult.summary,
        enrollments: enrollmentResult.summary,
        verification,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  const options = { apply: false, source: defaultSourcePath };

  for (const arg of args) {
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg.startsWith("--source=")) {
      options.source = path.resolve(arg.slice("--source=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
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

function readCsvRecords(filePath) {
  const lines = readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const headers = splitCsvLine(lines.shift()).map(normalizeHeader);
  const column = {
    lastName: findColumn(headers, ["apellido/s", "apellido", "apellidos"]),
    firstName: findColumn(headers, ["nombre/s", "nombre", "nombres"]),
    email: findColumn(headers, ["correo electronico", "email", "e-mail"]),
    phone: findColumn(headers, ["telefono", "numero de telefono"]),
  };

  if (Object.values(column).some((index) => index == null)) {
    throw new Error("The enrollment CSV is missing required columns");
  }

  return lines.map((line, index) => {
    const values = splitCsvLine(line);
    const lastName = cleanCell(values[column.lastName]);
    const firstName = cleanCell(values[column.firstName]);

    return {
      index,
      lastName,
      firstName,
      fullName: `${lastName}, ${firstName}`,
      email: cleanCell(values[column.email]).toLowerCase(),
      phone: normalizePhone(values[column.phone]),
    };
  });
}

function validateSourceRows(rows) {
  if (rows.length === 0) {
    throw new Error("The enrollment CSV has no records");
  }

  const duplicateEmails = duplicateEntries(rows, (row) => row.email);
  if (duplicateEmails.length > 0) {
    throw new Error(
      `Duplicate enrollment emails: ${duplicateEmails.slice(0, 5).join(", ")}`,
    );
  }
}

function reconcileRows(rows, students, graduations) {
  const rowsByEmail = groupBy(rows, (row) => row.email);
  const rowsByPhone = groupBy(rows, (row) => row.phone);
  const studentsByEmail = groupBy(students, (student) =>
    normalizeEmail(student.email),
  );
  const studentsByPhone = groupBy(students, (student) =>
    normalizePhone(student.phone),
  );
  const approvedRows = new Set();
  const studentByRow = new Map();
  let approvedByEmail = 0;
  let approvedByPhoneAndName = 0;

  for (const graduation of graduations) {
    const student = graduation.expand?.student;
    if (!student) {
      throw new Error(`Graduation ${graduation.id} has no expanded student`);
    }

    const emailMatches = rowsByEmail.get(normalizeEmail(student.email)) ?? [];
    let row;

    const emailMatchIsAmbiguous =
      emailMatches.length === 1 &&
      (rowsByPhone.get(normalizePhone(student.phone))?.length ?? 0) > 1 &&
      !sameName(emailMatches[0], student);

    if (emailMatches.length === 1 && !emailMatchIsAmbiguous) {
      [row] = emailMatches;
      approvedByEmail += 1;
    } else {
      const phoneMatches = rowsByPhone.get(normalizePhone(student.phone)) ?? [];
      const phoneNameMatches = disambiguateByName(phoneMatches, student);

      if (phoneNameMatches.length !== 1) {
        throw new Error(
          `Could not reconcile approved student ${student.fullName} (${student.dni})`,
        );
      }

      [row] = phoneNameMatches;
      approvedByPhoneAndName += 1;
    }

    if (approvedRows.has(row.index)) {
      throw new Error(`Enrollment row ${row.fullName} matched twice`);
    }

    approvedRows.add(row.index);
    studentByRow.set(row.index, student);
  }

  for (const row of rows) {
    if (studentByRow.has(row.index)) {
      continue;
    }

    const emailMatches = studentsByEmail.get(row.email) ?? [];
    const emailMatchIsAmbiguous =
      emailMatches.length === 1 &&
      (rowsByPhone.get(row.phone)?.length ?? 0) > 1 &&
      !sameName(emailMatches[0], row);

    if (emailMatches.length === 1 && !emailMatchIsAmbiguous) {
      studentByRow.set(row.index, emailMatches[0]);
      continue;
    }

    const phoneMatches = studentsByPhone.get(row.phone) ?? [];
    const sourcePhoneIsShared = (rowsByPhone.get(row.phone)?.length ?? 0) > 1;
    const phoneNameMatches = disambiguateByName(
      phoneMatches,
      row,
      sourcePhoneIsShared,
    );

    if (phoneNameMatches.length === 1) {
      studentByRow.set(row.index, phoneNameMatches[0]);
    }
  }

  return {
    approvedRows,
    studentByRow,
    approvedByEmail,
    approvedByPhoneAndName,
  };
}

async function prepareStudentSchema(url, token, collection, students) {
  const hasIdentityKey = collection.fields.some(
    (field) => field.name === "identityKey",
  );
  const fields = collection.fields
    .map((field) =>
      field.name === "dni" ? { ...field, required: false } : field,
    )
    .concat(
      hasIdentityKey
        ? []
        : [{ name: "identityKey", type: "text", required: false }],
    );

  await updateCollection(url, token, collections.students, {
    fields,
    indexes: [
      "CREATE UNIQUE INDEX idx_students_dni ON students (dni) WHERE dni != ''",
      "CREATE INDEX idx_students_last_name ON students (lastName, firstName)",
    ],
  });

  for (const student of students) {
    const identityKey = student.dni
      ? `dni:${normalizeDni(student.dni)}`
      : `email:${normalizeEmail(student.email)}`;

    if (student.identityKey !== identityKey) {
      await writeRecord(url, token, collections.students, "PATCH", {
        identityKey,
      }, student.id);
      student.identityKey = identityKey;
    }
  }
}

async function requireStudentIdentityKey(url, token) {
  const collection = await getCollection(url, token, collections.students);
  const fields = collection.fields.map((field) =>
    field.name === "identityKey" ? { ...field, required: true } : field,
  );

  await updateCollection(url, token, collections.students, {
    fields,
    indexes: studentIndexes(),
  });
}

function studentIndexes() {
  return [
    "CREATE UNIQUE INDEX idx_students_dni ON students (dni) WHERE dni != ''",
    "CREATE UNIQUE INDEX idx_students_identity_key ON students (identityKey)",
    "CREATE INDEX idx_students_last_name ON students (lastName, firstName)",
  ];
}

async function syncStudents(
  url,
  token,
  rows,
  existingStudents,
  initialStudentByRow,
  apply,
) {
  const studentByRow = new Map(initialStudentByRow);
  const summary = { created: 0, identityKeysUpdated: 0, reused: 0 };

  for (const student of existingStudents) {
    const identityKey = student.dni
      ? `dni:${normalizeDni(student.dni)}`
      : `email:${normalizeEmail(student.email)}`;
    if (student.identityKey !== identityKey) {
      summary.identityKeysUpdated += 1;
    }
  }

  for (const row of rows) {
    const existing = studentByRow.get(row.index);
    if (existing) {
      summary.reused += 1;
      continue;
    }

    const record = {
      identityKey: `email:${row.email}`,
      dni: "",
      lastName: row.lastName,
      firstName: row.firstName,
      fullName: row.fullName,
      birthDate: "",
      gender: "",
      phone: row.phone,
      email: row.email,
    };
    summary.created += 1;

    const saved = apply
      ? await writeRecord(url, token, collections.students, "POST", record)
      : {
          id: `dry-run-student-${row.index}`,
          collectionId: "dry-run-students",
          ...record,
        };
    studentByRow.set(row.index, saved);
  }

  const rowsByStudentId = groupBy(rows, (row) => studentByRow.get(row.index)?.id);
  const duplicateRelations = Array.from(rowsByStudentId.values()).filter(
    (matchedRows) => matchedRows.length > 1,
  );

  if (duplicateRelations.length > 0) {
    throw new Error(
      `Multiple enrollment rows resolve to the same student: ${duplicateRelations
        .slice(0, 5)
        .map((matchedRows) => matchedRows.map((row) => row.fullName).join(" / "))
        .join(", ")}`,
    );
  }

  return { studentByRow, summary };
}

async function createEnrollmentCollection(
  url,
  token,
  studentsCollectionId,
  modulesCollectionId,
) {
  return createCollection(url, token, {
    name: collections.enrollments,
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
        collectionId: studentsCollectionId,
        cascadeDelete: false,
        minSelect: 1,
        maxSelect: 1,
      },
      {
        name: "module",
        type: "relation",
        required: true,
        collectionId: modulesCollectionId,
        cascadeDelete: false,
        minSelect: 1,
        maxSelect: 1,
      },
      { name: "cohort", type: "number", required: true },
      { name: "sourceFile", type: "text", required: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_student_module_enrollments_unique_key ON student_module_enrollments (uniqueKey)",
      "CREATE INDEX idx_student_module_enrollments_cohort ON student_module_enrollments (cohort)",
    ],
  });
}

async function syncEnrollments(
  url,
  token,
  rows,
  studentByRow,
  moduleRecord,
  existingEnrollments,
  apply,
) {
  const existingByKey = new Map(
    existingEnrollments.map((record) => [record.uniqueKey, record]),
  );
  const summary = { created: 0, updated: 0, unchanged: 0 };

  for (const row of rows) {
    const student = studentByRow.get(row.index);
    if (!student) {
      throw new Error(`Missing student relation for ${row.fullName}`);
    }

    const uniqueKey = `${cohort}-${moduleNumber}-${student.id}`;
    const nextRecord = {
      uniqueKey,
      student: student.id,
      module: moduleRecord.id,
      cohort,
      sourceFile,
    };
    const existing = existingByKey.get(uniqueKey);

    if (!existing) {
      summary.created += 1;
      if (apply) {
        await writeRecord(
          url,
          token,
          collections.enrollments,
          "POST",
          nextRecord,
        );
      }
    } else if (hasChanges(existing, nextRecord)) {
      summary.updated += 1;
      if (apply) {
        await writeRecord(
          url,
          token,
          collections.enrollments,
          "PATCH",
          nextRecord,
          existing.id,
        );
      }
    } else {
      summary.unchanged += 1;
    }
  }

  return { summary };
}

async function verifyImport(url, token, moduleId) {
  const [students, enrollments, graduations] = await Promise.all([
    getRecords(url, token, collections.students),
    getRecords(
      url,
      token,
      collections.enrollments,
      `filter=${encodeURIComponent(
        `cohort = ${cohort} && module = '${moduleId}'`,
      )}`,
    ),
    getRecords(
      url,
      token,
      collections.graduations,
      `filter=${encodeURIComponent(
        `cohort = ${cohort} && module = '${moduleId}'`,
      )}`,
    ),
  ]);

  return {
    students: students.length,
    enrollments: enrollments.length,
    approved: graduations.length,
    notApproved: enrollments.length - graduations.length,
    studentsWithoutDni: students.filter((student) => !student.dni).length,
    studentsWithoutIdentityKey: students.filter(
      (student) => !student.identityKey,
    ).length,
  };
}

async function authenticate(url, email, password) {
  const response = await fetch(
    `${url}/api/collections/_superusers/auth-with-password`,
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

async function getCollection(url, token, collection) {
  const response = await fetch(`${url}/api/collections/${collection}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to read collection ${collection}: ${response.status}`);
  }
  return payload;
}

async function findCollection(url, token, collection) {
  const response = await fetch(`${url}/api/collections/${collection}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404) {
    return null;
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Failed to read collection ${collection}: ${response.status}`);
  }
  return payload;
}

async function createCollection(url, token, schema) {
  const response = await fetch(`${url}/api/collections`, {
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
  return payload;
}

async function updateCollection(url, token, collection, data) {
  const response = await fetch(`${url}/api/collections/${collection}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Failed to update collection ${collection}: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function getRecords(url, token, collection, query = "") {
  const records = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const suffix = query ? `&${query}` : "";
    const response = await fetch(
      `${url}/api/collections/${collection}/records?page=${page}&perPage=500${suffix}`,
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

async function writeRecord(url, token, collection, method, data, id) {
  const target = id
    ? `${url}/api/collections/${collection}/records/${id}`
    : `${url}/api/collections/${collection}/records`;
  const response = await fetch(target, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Failed to write ${collection}: ${response.status} ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

function splitCsvLine(line = "") {
  const values = [];
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

function findColumn(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(normalizeHeader(name));
    if (index >= 0) {
      return index;
    }
  }
  return null;
}

function groupBy(items, getKey) {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) {
      continue;
    }
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function duplicateEntries(items, getKey) {
  return Array.from(groupBy(items, getKey).entries())
    .filter(([, values]) => values.length > 1)
    .map(([key]) => key);
}

function disambiguateByName(matches, person, forceName = false) {
  if (matches.length <= 1 && !forceName) {
    return matches;
  }

  const expectedName = normalizeName(person.lastName, person.firstName);
  return matches.filter(
    (candidate) =>
      normalizeName(candidate.lastName, candidate.firstName) === expectedName,
  );
}

function sameName(first, second) {
  return (
    normalizeName(first.lastName, first.firstName) ===
    normalizeName(second.lastName, second.firstName)
  );
}

function countDuplicates(items, getKey) {
  return duplicateEntries(items, getKey).length;
}

function hasChanges(existing, nextRecord) {
  return Object.entries(nextRecord).some(
    ([key, value]) => String(existing[key] ?? "") !== String(value ?? ""),
  );
}

function normalizeHeader(value = "") {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeName(lastName = "", firstName = "") {
  return normalizeText(`${lastName} ${firstName}`).replace(/\s+/g, " ");
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeEmail(value = "") {
  return cleanCell(value).toLowerCase();
}

function normalizePhone(value = "") {
  return cleanCell(value).replace(/\D/g, "");
}

function normalizeDni(value = "") {
  return cleanCell(value).replace(/\D/g, "");
}

function cleanCell(value = "") {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
