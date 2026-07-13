import { readFileSync } from "node:fs";
import path from "node:path";

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
  const url = env.NEXT_PUBLIC_POCKETBASE_URL?.replace(/\/$/, "");
  const email = env.POCKETBASE_ADMIN_EMAIL;
  const password = env.POCKETBASE_ADMIN_PASSWORD;

  if (!url || !email || !password) {
    throw new Error("Missing PocketBase environment variables in .env.local");
  }

  const sourceRows = readCsvRecords(options.source);
  validateSourceRows(sourceRows);
  const sourceDeduplication = deduplicateSourceRows(sourceRows);
  const rows = sourceDeduplication.rows;

  const token = await authenticate(url, email, password);
  const [enrollmentCollection, students, modules, graduations, enrollments] =
    await Promise.all([
      getCollection(url, token, collections.enrollments),
      getRecords(url, token, collections.students),
      getRecords(url, token, collections.modules),
      getRecords(url, token, collections.graduations),
      getRecords(url, token, collections.enrollments),
    ]);

  const moduleRecord = modules.find(
    (record) => Number(record.number) === options.module,
  );
  if (!moduleRecord) {
    throw new Error(`Module ${options.module} is missing in PocketBase`);
  }

  const moduleGraduations = graduations.filter(
    (record) =>
      Number(record.cohort) === options.cohort &&
      record.module === moduleRecord.id,
  );
  const targetEnrollments = enrollments.filter(
    (record) =>
      Number(record.cohort) === options.cohort &&
      record.module === moduleRecord.id,
  );
  const cohortStudentIds = new Set(
    enrollments
      .filter((record) => Number(record.cohort) === options.cohort)
      .map((record) => record.student),
  );
  const reconciliation = reconcileRows(
    rows,
    students,
    moduleGraduations.map((record) => record.student),
    cohortStudentIds,
  );
  const deduplication = deduplicateMatchedRows(
    rows,
    reconciliation.studentByRow,
  );
  const importRows = deduplication.rows;
  const unidentifiedRows = importRows.filter(
    (row) =>
      !reconciliation.studentByRow.has(row.index) &&
      !row.dni &&
      !row.email,
  );
  if (unidentifiedRows.length > 0) {
    throw new Error(
      `Cannot identify ${unidentifiedRows.length} name-only rows: ${unidentifiedRows
        .map((row) => row.fullName)
        .join(" | ")}`,
    );
  }
  const approvedStudentIds = new Set(
    moduleGraduations.map((record) => record.student),
  );
  const matchedStudentIds = new Set(
    Array.from(reconciliation.studentByRow.values(), (student) => student.id),
  );
  const approvedOutsideSource = moduleGraduations.filter(
    (record) => !matchedStudentIds.has(record.student),
  );

  const studentsById = new Map(students.map((student) => [student.id, student]));
  const inferredApprovedStudents = approvedOutsideSource.map((record) => {
    const student = studentsById.get(record.student);
    if (!student) throw new Error(`Approved student ${record.student} is missing`);
    return student;
  });

  const sourceStudentIds = new Set(
    Array.from(reconciliation.studentByRow.values(), (student) => student.id),
  );
  inferredApprovedStudents.forEach((student) => sourceStudentIds.add(student.id));
  const targetOutsideSource = targetEnrollments.filter(
    (record) => !sourceStudentIds.has(record.student),
  );
  if (targetOutsideSource.length > 0) {
    throw new Error(
      `${targetOutsideSource.length} existing target enrollments are absent from the source CSV; no records were deleted`,
    );
  }

  const schema = {
    enrollmentTypeAdded: !enrollmentCollection.fields.some(
      (field) => field.name === "enrollmentType",
    ),
  };
  if (options.apply && schema.enrollmentTypeAdded) {
    await addEnrollmentTypeField(url, token, enrollmentCollection);
  }

  const studentResult = await syncStudents(
    url,
    token,
    importRows,
    reconciliation.studentByRow,
    options.apply,
  );
  const enrollmentTypes = classifyEnrollments(enrollments);
  const backfill = await backfillEnrollmentTypes(
    url,
    token,
    enrollments,
    enrollmentTypes,
    options.apply,
  );
  const enrollmentResult = await syncEnrollments(
    url,
    token,
    importRows,
    studentResult.studentByRow,
    moduleRecord,
    enrollments,
    approvedStudentIds,
    inferredApprovedStudents,
    options,
  );

  const verification = options.apply
    ? await verifyImport(url, token, options.cohort, moduleRecord.id)
    : null;

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        source: {
          file: options.source,
          rows: sourceRows.length,
          uniquePeople: importRows.length,
          duplicatePeople: [
            ...sourceDeduplication.duplicates,
            ...deduplication.duplicates,
          ],
          withoutDni: sourceRows.filter((row) => !row.dni).length,
        },
        target: { cohort: options.cohort, module: options.module },
        reconciliation: {
          matchedByDni: reconciliation.matchedByDni,
          matchedByEmail: reconciliation.matchedByEmail,
          matchedByName: reconciliation.matchedByName,
          matchedByShortName: reconciliation.matchedByShortName,
          matchedByPhoneAndName: reconciliation.matchedByPhoneAndName,
          newStudents: importRows.filter(
            (row) => !reconciliation.studentByRow.has(row.index),
          ).length,
          newStudentCandidates: importRows
            .filter((row) => !reconciliation.studentByRow.has(row.index))
            .map((row) => ({
              name: row.fullName,
              dni: row.dni,
              email: row.email,
            })),
          approved: moduleGraduations.length,
          notApproved:
            importRows.length + inferredApprovedStudents.length - moduleGraduations.length,
          approvedOutsideSource: approvedOutsideSource.length,
          inferredEnrollmentsFromApproval: inferredApprovedStudents.length,
          inferredApprovedStudents: inferredApprovedStudents.map((student) => ({
            name: student.fullName,
            dni: student.dni,
            email: student.email,
          })),
          identityConflicts: reconciliation.identityConflicts,
          targetEnrollmentsOutsideSource: targetOutsideSource.length,
        },
        schema,
        students: studentResult.summary,
        historicalEnrollmentTypes: backfill,
        enrollments: enrollmentResult,
        verification,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  const options = { apply: false, cohort: 0, module: 0, source: "" };

  for (const arg of args) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg.startsWith("--cohort=")) options.cohort = Number(arg.slice(9));
    else if (arg.startsWith("--module=")) options.module = Number(arg.slice(9));
    else if (arg.startsWith("--source=")) options.source = path.resolve(arg.slice(9));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.cohort) || options.cohort < 1) {
    throw new Error("--cohort must be a positive integer");
  }
  if (!Number.isInteger(options.module) || options.module < 1) {
    throw new Error("--module must be a positive integer");
  }
  if (!options.source) throw new Error("--source is required");
  return options;
}

function readEnv() {
  return Object.fromEntries(
    readFileSync(".env.local", "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#"))
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
  const columns = {
    combinedName: findColumn(headers, [
      "alumnos",
      "nombre/s y apellidos",
      "nombre y apellido",
      "nombre completo",
    ]),
    lastName: findColumn(headers, ["apellido/s", "apellido", "apellidos"]),
    firstName: findColumn(headers, ["nombre/s", "nombre", "nombres"]),
    dni: findColumn(headers, ["dni", "documento"]),
    email: findColumn(headers, ["e-mail", "email", "correo electronico"]),
    phone: findColumn(headers, ["telefono", "numero de telefono"]),
  };

  if (
    columns.combinedName == null &&
    (columns.lastName == null || columns.firstName == null)
  ) {
    throw new Error("The enrollment CSV has no usable name columns");
  }

  return lines.map((line, index) => {
    const values = splitCsvLine(line);
    const lastName = cleanCell(readColumn(values, columns.lastName));
    const firstName = cleanCell(readColumn(values, columns.firstName));
    const combinedName =
      columns.combinedName == null
        ? ""
        : cleanCell(readColumn(values, columns.combinedName));
    const hasStructuredName = Boolean(lastName || firstName);
    return {
      index,
      lastName,
      firstName,
      fullName: hasStructuredName
        ? `${lastName}, ${firstName}`
        : combinedName,
      hasStructuredName,
      dni: normalizeDni(readColumn(values, columns.dni)),
      email: normalizeEmail(readColumn(values, columns.email)),
      phone: normalizePhone(readColumn(values, columns.phone)),
    };
  });
}

function validateSourceRows(rows) {
  if (rows.length === 0) throw new Error("The enrollment CSV has no records");
  const rowsWithoutName = rows.filter((row) => !row.fullName);
  if (rowsWithoutName.length > 0) {
    throw new Error(`${rowsWithoutName.length} enrollment rows have no name`);
  }
}

function reconcileRows(rows, students, approvedStudentIds, cohortStudentIds) {
  const byDni = groupBy(students, (student) => normalizeDni(student.dni));
  const byEmail = groupBy(students, (student) => normalizeEmail(student.email));
  const byPhone = groupBy(students, (student) => normalizePhone(student.phone));
  const byName = groupBy(students, (student) =>
    normalizePersonName(student.fullName || `${student.lastName} ${student.firstName}`),
  );
  const byShortName = groupBy(students, (student) =>
    shortNameKey(student.lastName, student.firstName),
  );
  const approvedIds = new Set(approvedStudentIds);
  const approvedStudents = students.filter((student) => approvedIds.has(student.id));
  const approvedByDni = groupBy(approvedStudents, (student) => normalizeDni(student.dni));
  const approvedByEmail = groupBy(approvedStudents, (student) => normalizeEmail(student.email));
  const approvedByPhone = groupBy(approvedStudents, (student) => normalizePhone(student.phone));
  const approvedByName = groupBy(approvedStudents, (student) =>
    normalizePersonName(student.fullName || `${student.lastName} ${student.firstName}`),
  );
  const approvedByShortName = groupBy(approvedStudents, (student) =>
    shortNameKey(student.lastName, student.firstName),
  );
  const studentByRow = new Map();
  let matchedByDni = 0;
  let matchedByEmail = 0;
  let matchedByName = 0;
  let matchedByShortName = 0;
  let matchedByPhoneAndName = 0;
  const identityConflicts = [];

  for (const row of rows) {
    let match;
    if (row.dni) {
      match = uniqueMatch(approvedByDni.get(row.dni), row, "approved DNI");
    }
    if (!match && row.email) {
      match = uniqueMatch(approvedByEmail.get(row.email), row, "approved email");
    }
    if (!match && row.fullName) {
      match = uniqueMatch(
        approvedByName.get(normalizePersonName(row.fullName)),
        row,
        "approved name",
      );
      if (match) matchedByName += 1;
    }
    if (!match) {
      const key = rowShortNameKey(row);
      if (key) {
        match = uniqueMatch(
          approvedByShortName.get(key),
          row,
          "approved surname and first name",
        );
        if (match) matchedByShortName += 1;
      }
    }
    if (!match && row.phone) {
      match = uniqueMatch(approvedByPhone.get(row.phone), row, "approved phone");
    }
    if (!match && row.dni) {
      match = uniqueMatch(byDni.get(row.dni), row, "DNI", cohortStudentIds);
    }
    if (match && row.dni && normalizeDni(match.dni) === row.dni) {
      matchedByDni += 1;
    }
    if (!match && row.email) {
      const candidate = uniqueMatch(
        byEmail.get(row.email),
        row,
        "email",
        cohortStudentIds,
      );
      match = candidate;
      if (match) matchedByEmail += 1;
    }
    if (!match && row.fullName) {
      match = uniqueMatch(
        byName.get(normalizePersonName(row.fullName)),
        row,
        "name",
        cohortStudentIds,
      );
      if (match) matchedByName += 1;
    }
    if (!match) {
      const key = rowShortNameKey(row);
      if (key) {
        match = uniqueMatch(
          byShortName.get(key),
          row,
          "surname and first name",
          cohortStudentIds,
        );
        if (match) matchedByShortName += 1;
      }
    }
    if (!match && row.phone) {
      const candidates = (byPhone.get(row.phone) ?? []).filter(
        (student) => sameName(student, row),
      );
      match = uniqueMatch(candidates, row, "phone and name");
      if (match) matchedByPhoneAndName += 1;
    }
    if (match && row.dni && match.dni && normalizeDni(match.dni) !== row.dni) {
      identityConflicts.push({
        student: row.fullName,
        csvDni: row.dni,
        pocketBaseDni: normalizeDni(match.dni),
      });
    }
    if (match) studentByRow.set(row.index, match);
  }

  return {
    studentByRow,
    matchedByDni,
    matchedByEmail,
    matchedByName,
    matchedByShortName,
    matchedByPhoneAndName,
    identityConflicts,
  };
}

function readColumn(values, index) {
  return index == null ? "" : values[index];
}

function deduplicateSourceRows(rows) {
  const byEmail = deduplicateRowsByKey(rows, (row) => row.email, "email");
  const byDni = deduplicateRowsByKey(byEmail.rows, (row) => row.dni, "DNI");
  return {
    rows: byDni.rows,
    duplicates: [...byEmail.duplicates, ...byDni.duplicates],
  };
}

function deduplicateRowsByKey(rows, getKey, reason) {
  const groups = groupBy(rows, getKey);
  const removedIndexes = new Set();
  const duplicates = [];

  for (const [key, matchedRows] of groups) {
    if (matchedRows.length < 2) continue;
    const names = new Set(
      matchedRows.map((row) => normalizePersonName(row.fullName)),
    );
    const dniValues = new Set(matchedRows.map((row) => row.dni).filter(Boolean));
    if (names.size > 1 || dniValues.size > 1) {
      throw new Error(
        `Conflicting rows share ${reason} ${key}: ${matchedRows
          .map((row) => row.fullName)
          .join(" | ")}`,
      );
    }

    const preferredRow = [...matchedRows].sort(
      (first, second) => sourceRowScore(second) - sourceRowScore(first),
    )[0];
    for (const row of matchedRows) {
      if (row.index !== preferredRow.index) removedIndexes.add(row.index);
    }
    duplicates.push({
      student: preferredRow.fullName,
      reason,
      value: key,
      removedRows: matchedRows.length - 1,
    });
  }

  return {
    rows: rows.filter((row) => !removedIndexes.has(row.index)),
    duplicates,
  };
}

function sourceRowScore(row) {
  return [row.dni, row.email, row.phone, row.lastName, row.firstName].filter(
    Boolean,
  ).length;
}

function deduplicateMatchedRows(rows, studentByRow) {
  const rowsByStudentId = groupBy(
    rows.filter((row) => studentByRow.has(row.index)),
    (row) => studentByRow.get(row.index).id,
  );
  const removedIndexes = new Set();
  const duplicates = [];

  for (const matchedRows of rowsByStudentId.values()) {
    if (matchedRows.length < 2) continue;
    const student = studentByRow.get(matchedRows[0].index);
    const preferredRow =
      matchedRows.find(
        (row) => row.email === normalizeEmail(student.email),
      ) ?? matchedRows[0];

    for (const row of matchedRows) {
      if (row.index !== preferredRow.index) removedIndexes.add(row.index);
    }
    duplicates.push({
      student: student.fullName,
      keptEmail: preferredRow.email,
      duplicateEmails: matchedRows
        .filter((row) => row.index !== preferredRow.index)
        .map((row) => row.email),
    });
  }

  return {
    rows: rows.filter((row) => !removedIndexes.has(row.index)),
    duplicates,
  };
}

function uniqueMatch(matches = [], row, field, preferredStudentIds) {
  if (matches.length > 1 && preferredStudentIds) {
    const preferredMatches = matches.filter((student) =>
      preferredStudentIds.has(student.id),
    );
    if (preferredMatches.length === 1) return preferredMatches[0];
  }
  if (matches.length > 1) {
    throw new Error(`Ambiguous ${field} match for ${row.fullName}`);
  }
  return matches[0];
}

async function syncStudents(url, token, rows, initialStudentByRow, apply) {
  const studentByRow = new Map(initialStudentByRow);
  const summary = { created: 0, updated: 0, unchanged: 0 };

  for (const row of rows) {
    const existing = studentByRow.get(row.index);
    if (!existing) {
      if (!row.dni && !row.email) {
        throw new Error(
          `Cannot create ${row.fullName} without DNI or email`,
        );
      }
      const record = {
        identityKey: row.dni ? `dni:${row.dni}` : `email:${row.email}`,
        dni: row.dni,
        lastName: row.lastName || row.fullName,
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
        : { id: `dry-run-student-${row.index}`, ...record };
      studentByRow.set(row.index, saved);
      continue;
    }

    const hasDniConflict =
      row.dni && existing.dni && normalizeDni(existing.dni) !== row.dni;
    const nextDni = hasDniConflict ? existing.dni : row.dni || existing.dni;
    const next = {
      identityKey: nextDni ? `dni:${normalizeDni(nextDni)}` : existing.identityKey,
      dni: nextDni,
      lastName: row.hasStructuredName ? row.lastName : existing.lastName,
      firstName: row.hasStructuredName ? row.firstName : existing.firstName,
      fullName: row.hasStructuredName ? row.fullName : existing.fullName,
      phone: row.phone || existing.phone,
      email: row.email || existing.email,
    };
    if (hasChanges(existing, next)) {
      summary.updated += 1;
      if (apply) {
        const saved = await writeRecord(
          url,
          token,
          collections.students,
          "PATCH",
          next,
          existing.id,
        );
        studentByRow.set(row.index, saved);
      }
    } else {
      summary.unchanged += 1;
    }
  }
  return { studentByRow, summary };
}

function classifyEnrollments(enrollments) {
  const groups = groupBy(
    enrollments,
    (record) => `${record.student}|${record.module}`,
  );
  const byRecordId = new Map();
  for (const records of groups.values()) {
    records.sort((first, second) => Number(first.cohort) - Number(second.cohort));
    records.forEach((record, index) => {
      byRecordId.set(record.id, index === 0 ? "new" : "repeater");
    });
  }
  return byRecordId;
}

async function backfillEnrollmentTypes(url, token, enrollments, types, apply) {
  const summary = { updated: 0, unchanged: 0 };
  for (const enrollment of enrollments) {
    const enrollmentType = types.get(enrollment.id);
    if (enrollment.enrollmentType === enrollmentType) {
      summary.unchanged += 1;
      continue;
    }
    summary.updated += 1;
    if (apply) {
      await writeRecord(
        url,
        token,
        collections.enrollments,
        "PATCH",
        { enrollmentType },
        enrollment.id,
      );
    }
  }
  return summary;
}

async function syncEnrollments(
  url,
  token,
  rows,
  studentByRow,
  moduleRecord,
  existingEnrollments,
  approvedStudentIds,
  inferredApprovedStudents,
  options,
) {
  const existingByKey = new Map(
    existingEnrollments.map((record) => [record.uniqueKey, record]),
  );
  const priorStudentIds = new Set(
    existingEnrollments
      .filter(
        (record) =>
          record.module === moduleRecord.id &&
          Number(record.cohort) < options.cohort,
      )
      .map((record) => record.student),
  );
  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    new: 0,
    repeaters: 0,
    approved: 0,
    notApproved: 0,
  };

  for (const row of rows) {
    const student = studentByRow.get(row.index);
    const enrollmentType = priorStudentIds.has(student.id) ? "repeater" : "new";
    const uniqueKey = `${options.cohort}-${options.module}-${student.id}`;
    const next = {
      uniqueKey,
      student: student.id,
      module: moduleRecord.id,
      cohort: options.cohort,
      sourceFile: path.basename(options.source),
      enrollmentType,
    };
    const existing = existingByKey.get(uniqueKey);
    summary[enrollmentType === "new" ? "new" : "repeaters"] += 1;
    summary[approvedStudentIds.has(student.id) ? "approved" : "notApproved"] += 1;

    if (!existing) {
      summary.created += 1;
      if (options.apply) {
        await writeRecord(url, token, collections.enrollments, "POST", next);
      }
    } else if (hasChanges(existing, next)) {
      summary.updated += 1;
      if (options.apply) {
        await writeRecord(
          url,
          token,
          collections.enrollments,
          "PATCH",
          next,
          existing.id,
        );
      }
    } else {
      summary.unchanged += 1;
    }
  }

  for (const student of inferredApprovedStudents) {
    const enrollmentType = priorStudentIds.has(student.id) ? "repeater" : "new";
    const uniqueKey = `${options.cohort}-${options.module}-${student.id}`;
    const next = {
      uniqueKey,
      student: student.id,
      module: moduleRecord.id,
      cohort: options.cohort,
      sourceFile: `derived:approved-not-in-${path.basename(options.source)}`,
      enrollmentType,
    };
    const existing = existingByKey.get(uniqueKey);
    summary[enrollmentType === "new" ? "new" : "repeaters"] += 1;
    summary.approved += 1;

    if (!existing) {
      summary.created += 1;
      if (options.apply) {
        await writeRecord(url, token, collections.enrollments, "POST", next);
      }
    } else if (hasChanges(existing, next)) {
      summary.updated += 1;
      if (options.apply) {
        await writeRecord(
          url,
          token,
          collections.enrollments,
          "PATCH",
          next,
          existing.id,
        );
      }
    } else {
      summary.unchanged += 1;
    }
  }
  return summary;
}

async function addEnrollmentTypeField(url, token, collection) {
  await updateCollection(url, token, collections.enrollments, {
    fields: [
      ...collection.fields,
      {
        name: "enrollmentType",
        type: "select",
        required: false,
        maxSelect: 1,
        values: ["new", "repeater"],
      },
    ],
    indexes: collection.indexes,
  });
}

async function verifyImport(url, token, cohort, moduleId) {
  const [enrollments, graduations] = await Promise.all([
    getRecords(url, token, collections.enrollments),
    getRecords(url, token, collections.graduations),
  ]);
  const targetEnrollments = enrollments.filter(
    (record) => Number(record.cohort) === cohort && record.module === moduleId,
  );
  const targetGraduations = graduations.filter(
    (record) => Number(record.cohort) === cohort && record.module === moduleId,
  );
  return {
    enrolled: targetEnrollments.length,
    approved: targetGraduations.length,
    notApproved: targetEnrollments.length - targetGraduations.length,
    new: targetEnrollments.filter((record) => record.enrollmentType === "new").length,
    repeaters: targetEnrollments.filter(
      (record) => record.enrollmentType === "repeater",
    ).length,
    withoutEnrollmentType: targetEnrollments.filter(
      (record) => !record.enrollmentType,
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

async function getRecords(url, token, collection) {
  const records = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const response = await fetch(
      `${url}/api/collections/${collection}/records?page=${page}&perPage=500`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(`Failed to read ${collection}: ${response.status}`);
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
    } else if (char === '"') inQuotes = !inQuotes;
    else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else current += char;
  }
  values.push(current);
  return values;
}

function findColumn(headers, names) {
  for (const name of names) {
    const index = headers.indexOf(normalizeHeader(name));
    if (index >= 0) return index;
  }
  return null;
}

function groupBy(items, getKey) {
  const grouped = new Map();
  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

function hasChanges(existing, next) {
  return Object.entries(next).some(
    ([key, value]) => String(existing[key] ?? "") !== String(value ?? ""),
  );
}

function sameName(first, second) {
  return normalizeName(first.lastName, first.firstName) === normalizeName(second.lastName, second.firstName);
}

function normalizeHeader(value = "") {
  return normalizeText(value).replace(/\s+/g, " ");
}

function normalizeName(lastName = "", firstName = "") {
  return normalizeText(`${lastName} ${firstName}`).replace(/\s+/g, " ");
}

function normalizePersonName(value = "") {
  return normalizeText(value.replace(/,/g, " "))
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function rowShortNameKey(row) {
  if (row.hasStructuredName) {
    return shortNameKey(row.lastName, row.firstName);
  }
  const [lastName, firstName = ""] = row.fullName.split(",", 2);
  return shortNameKey(lastName, firstName);
}

function shortNameKey(lastName = "", firstName = "") {
  const normalizedLastName = normalizeText(lastName).replace(/\s+/g, " ");
  const firstGivenName = normalizeText(firstName).split(/\s+/).filter(Boolean)[0];
  return normalizedLastName && firstGivenName
    ? `${normalizedLastName}|${firstGivenName}`
    : "";
}

function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeDni(value = "") {
  return cleanCell(value).replace(/\D/g, "");
}

function normalizeEmail(value = "") {
  return cleanCell(value).toLowerCase();
}

function normalizePhone(value = "") {
  return cleanCell(value).replace(/\D/g, "");
}

function cleanCell(value = "") {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
