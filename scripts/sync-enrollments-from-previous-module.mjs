import { readFileSync } from "node:fs";

const collections = {
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

  const token = await authenticate(pocketBaseUrl, email, password);
  const modules = await getRecords(
    pocketBaseUrl,
    token,
    collections.modules,
  );
  const sourceModule = modules.find(
    (record) => Number(record.number) === options.sourceModule,
  );
  const targetModule = modules.find(
    (record) => Number(record.number) === options.targetModule,
  );

  if (!sourceModule || !targetModule) {
    throw new Error("Source or target academic module is missing");
  }

  const [sourceGraduations, targetGraduations, existingEnrollments] =
    await Promise.all([
      getRecords(
        pocketBaseUrl,
        token,
        collections.graduations,
        graduationFilter(options.cohort, sourceModule.id),
      ),
      getRecords(
        pocketBaseUrl,
        token,
        collections.graduations,
        graduationFilter(options.cohort, targetModule.id),
      ),
      getRecords(
        pocketBaseUrl,
        token,
        collections.enrollments,
        graduationFilter(options.cohort, targetModule.id),
      ),
    ]);

  const sourceStudentIds = new Set(
    sourceGraduations.map((record) => record.student),
  );
  const targetApprovedOutsideSource = targetGraduations.filter(
    (record) => !sourceStudentIds.has(record.student),
  );

  if (targetApprovedOutsideSource.length > 0) {
    throw new Error(
      `${targetApprovedOutsideSource.length} target-module graduates did not approve the source module`,
    );
  }

  const existingByKey = new Map(
    existingEnrollments.map((record) => [record.uniqueKey, record]),
  );
  const summary = { created: 0, updated: 0, unchanged: 0 };
  const sourceFile = `derived:cohort-${options.cohort}-module-${options.sourceModule}-graduates`;

  for (const graduation of sourceGraduations) {
    const uniqueKey = `${options.cohort}-${options.targetModule}-${graduation.student}`;
    const nextRecord = {
      uniqueKey,
      student: graduation.student,
      module: targetModule.id,
      cohort: options.cohort,
      sourceFile,
    };
    const existing = existingByKey.get(uniqueKey);

    if (!existing) {
      summary.created += 1;
      if (options.apply) {
        await writeRecord(
          pocketBaseUrl,
          token,
          collections.enrollments,
          "POST",
          nextRecord,
        );
      }
    } else if (hasChanges(existing, nextRecord)) {
      summary.updated += 1;
      if (options.apply) {
        await writeRecord(
          pocketBaseUrl,
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

  const verification = options.apply
    ? await verifyImport(
        pocketBaseUrl,
        token,
        options.cohort,
        targetModule.id,
      )
    : null;

  console.log(
    JSON.stringify(
      {
        mode: options.apply ? "apply" : "dry-run",
        cohort: options.cohort,
        sourceModule: options.sourceModule,
        targetModule: options.targetModule,
        sourceApproved: sourceGraduations.length,
        targetApproved: targetGraduations.length,
        expectedNotApproved:
          sourceGraduations.length - targetGraduations.length,
        targetApprovedOutsideSource: targetApprovedOutsideSource.length,
        enrollments: summary,
        verification,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args) {
  const options = {
    apply: false,
    cohort: 1,
    sourceModule: 1,
    targetModule: 2,
  };

  for (const arg of args) {
    if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--dry-run") {
      options.apply = false;
    } else if (arg.startsWith("--cohort=")) {
      options.cohort = Number(arg.slice("--cohort=".length));
    } else if (arg.startsWith("--source-module=")) {
      options.sourceModule = Number(arg.slice("--source-module=".length));
    } else if (arg.startsWith("--target-module=")) {
      options.targetModule = Number(arg.slice("--target-module=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (
    !Number.isInteger(options.cohort) ||
    !Number.isInteger(options.sourceModule) ||
    !Number.isInteger(options.targetModule)
  ) {
    throw new Error("Cohort and module numbers must be integers");
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

function graduationFilter(cohort, moduleId) {
  return `filter=${encodeURIComponent(
    `cohort = ${cohort} && module = '${moduleId}'`,
  )}`;
}

async function verifyImport(url, token, cohort, moduleId) {
  const [enrollments, graduations] = await Promise.all([
    getRecords(
      url,
      token,
      collections.enrollments,
      graduationFilter(cohort, moduleId),
    ),
    getRecords(
      url,
      token,
      collections.graduations,
      graduationFilter(cohort, moduleId),
    ),
  ]);

  return {
    enrolled: enrollments.length,
    approved: graduations.length,
    notApproved: enrollments.length - graduations.length,
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

function hasChanges(existing, nextRecord) {
  return Object.entries(nextRecord).some(
    ([key, value]) => String(existing[key] ?? "") !== String(value ?? ""),
  );
}
