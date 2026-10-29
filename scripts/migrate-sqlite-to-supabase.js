require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const { createDatabase, getConnectionOptions, REQUIRED_TABLES } = require("../server/db");

const MIGRATION_KEY = "sqlite-initial-import-v1";
const COLUMNS = {
  customers: ["id", "name", "mobile", "address", "created_at", "is_active"],
  bills: [
    "id", "customer_id", "bill_date", "start_time", "end_time", "usage_minutes",
    "rate_paise_per_hour", "amount_paise", "previous_due_paise", "total_due_paise", "created_at",
  ],
  payments: ["id", "customer_id", "payment_date", "amount_paise", "mode", "note", "created_at"],
  payment_allocations: ["id", "payment_id", "bill_id", "amount_paise", "created_at"],
  settings: ["key", "value", "updated_at"],
  notebook_dues: ["id", "customer_id", "due_date", "amount_paise", "note", "created_at"],
  notebook_allocations: ["id", "payment_id", "notebook_due_id", "amount_paise", "created_at"],
};
const IMPORT_ORDER = [
  "customers",
  "bills",
  "payments",
  "notebook_dues",
  "payment_allocations",
  "notebook_allocations",
  "settings",
];
const RELATIONSHIPS = [
  ["bills", "customer_id", "customers"],
  ["payments", "customer_id", "customers"],
  ["payment_allocations", "payment_id", "payments"],
  ["payment_allocations", "bill_id", "bills"],
  ["notebook_dues", "customer_id", "customers"],
  ["notebook_allocations", "payment_id", "payments"],
  ["notebook_allocations", "notebook_due_id", "notebook_dues"],
];

function getSqlitePath(env = process.env) {
  if (env.SQLITE_PATH) return path.resolve(env.SQLITE_PATH);
  if (env.NODE_ENV === "production") return path.join("/data", "tubewell.db");
  return path.join(__dirname, "..", "data", "tubewell.db");
}

function getCounts(rowsByTable) {
  return Object.fromEntries(
    REQUIRED_TABLES.map((table) => [table, rowsByTable[table].length]),
  );
}

function readRows(source) {
  return Object.fromEntries(
    REQUIRED_TABLES.map((table) => [table, source.prepare(`SELECT * FROM \`${table}\``).all()]),
  );
}

function getMissingRelationships(rowsByTable) {
  const idsByTable = Object.fromEntries(
    Object.entries(rowsByTable).map(([table, rows]) => [
      table,
      new Set(rows.map((row) => row.id)),
    ]),
  );
  return RELATIONSHIPS.flatMap(([child, column, parent]) => {
    const missing = rowsByTable[child].filter((row) => !idsByTable[parent].has(row[column]));
    return missing.length ? [{ table: child, column, missing: missing.length }] : [];
  });
}

function getInconsistentRelationships(rowsByTable) {
  const payments = new Map(rowsByTable.payments.map((row) => [row.id, row]));
  const bills = new Map(rowsByTable.bills.map((row) => [row.id, row]));
  const notebookDues = new Map(rowsByTable.notebook_dues.map((row) => [row.id, row]));
  const paymentBillMismatches = rowsByTable.payment_allocations.filter((allocation) => (
    payments.get(allocation.payment_id)?.customer_id !== bills.get(allocation.bill_id)?.customer_id
  )).length;
  const paymentNotebookMismatches = rowsByTable.notebook_allocations.filter((allocation) => (
    payments.get(allocation.payment_id)?.customer_id !== notebookDues.get(allocation.notebook_due_id)?.customer_id
  )).length;

  return [
    paymentBillMismatches && {
      table: "payment_allocations",
      relationship: "payment/bill customer",
      inconsistent: paymentBillMismatches,
    },
    paymentNotebookMismatches && {
      table: "notebook_allocations",
      relationship: "payment/notebook-due customer",
      inconsistent: paymentNotebookMismatches,
    },
  ].filter(Boolean);
}

function hashRows(rowsByTable) {
  const hash = crypto.createHash("sha256");
  for (const table of IMPORT_ORDER) {
    hash.update(table);
    hash.update(JSON.stringify(rowsByTable[table]));
  }
  return hash.digest("hex");
}

async function getTargetCounts(db) {
  const counts = {};
  for (const table of REQUIRED_TABLES) {
    const [row] = await db.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
    counts[table] = Number(row.count);
  }
  return counts;
}

async function getTargetRelationshipProblems(db) {
  const problems = [];
  for (const [child, column, parent] of RELATIONSHIPS) {
    const [row] = await db.query(`
      SELECT COUNT(*) AS count
      FROM \`${child}\` AS c
      LEFT JOIN \`${parent}\` AS p ON p.id = c.\`${column}\`
      WHERE c.\`${column}\` IS NOT NULL AND p.id IS NULL
    `);
    if (Number(row.count)) {
      problems.push({ table: child, column, missing: Number(row.count) });
    }
  }
  const consistencyChecks = [
    {
      table: "payment_allocations",
      relationship: "payment/bill customer",
      sql: `
        SELECT COUNT(*) AS count
        FROM payment_allocations AS a
        JOIN payments AS p ON p.id = a.payment_id
        JOIN bills AS b ON b.id = a.bill_id
        WHERE p.customer_id <> b.customer_id
      `,
    },
    {
      table: "notebook_allocations",
      relationship: "payment/notebook-due customer",
      sql: `
        SELECT COUNT(*) AS count
        FROM notebook_allocations AS a
        JOIN payments AS p ON p.id = a.payment_id
        JOIN notebook_dues AS n ON n.id = a.notebook_due_id
        WHERE p.customer_id <> n.customer_id
      `,
    },
  ];
  for (const check of consistencyChecks) {
    const [row] = await db.query(check.sql);
    if (Number(row.count)) {
      problems.push({ table: check.table, relationship: check.relationship, inconsistent: Number(row.count) });
    }
  }
  return problems;
}

async function runMigration({ sqlitePath = getSqlitePath(), pool } = {}) {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite database not found: ${sqlitePath}. Set SQLITE_PATH to the source file.`);
  }

  const source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  let db;
  try {
    db = createDatabase(pool || new Pool(getConnectionOptions()));
    const rowsByTable = readRows(source);
    const sourceCounts = getCounts(rowsByTable);
    const sourceRelationshipProblems = [
      ...getMissingRelationships(rowsByTable),
      ...getInconsistentRelationships(rowsByTable),
    ];
    if (sourceRelationshipProblems.length) {
      throw new Error(`SQLite source contains broken relationships: ${JSON.stringify(sourceRelationshipProblems)}`);
    }

    await db.initialize({ seedDefaults: false });

    const [priorImport] = await db.query(
      "SELECT migration_key FROM migration_history WHERE migration_key = ?",
      [MIGRATION_KEY],
    );
    if (priorImport) {
      throw new Error("The initial SQLite import has already completed; refusing to run it again.");
    }

    const targetCounts = await getTargetCounts(db);
    const populated = Object.entries(targetCounts).filter(([, count]) => count > 0);
    if (populated.length) {
      throw new Error(
        `Supabase database is not empty; refusing to overwrite or duplicate data: ${JSON.stringify(Object.fromEntries(populated))}`,
      );
    }

    const sourceHash = hashRows(rowsByTable);
    await db.transaction(async (tx) => {
      for (const table of IMPORT_ORDER) {
        const columns = COLUMNS[table];
        const placeholders = columns.map(() => "?").join(", ");
        const sql = `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`;
        for (const row of rowsByTable[table]) {
          await tx.execute(sql, columns.map((column) => row[column]));
        }
      }

      for (const table of ["customers", "bills", "payments", "payment_allocations", "notebook_dues", "notebook_allocations"]) {
        await tx.query(`
          SELECT setval(
            pg_get_serial_sequence('"${table}"', 'id'),
            COALESCE(MAX(id), 1),
            MAX(id) IS NOT NULL
          )
          FROM "${table}"
        `);
      }

      const importedCounts = await getTargetCounts(tx);
      if (JSON.stringify(importedCounts) !== JSON.stringify(sourceCounts)) {
        throw new Error(`Row count verification failed. Source=${JSON.stringify(sourceCounts)} Supabase=${JSON.stringify(importedCounts)}`);
      }
      const relationshipProblems = await getTargetRelationshipProblems(tx);
      if (relationshipProblems.length) {
        throw new Error(`Supabase import contains broken relationships: ${JSON.stringify(relationshipProblems)}`);
      }
      await tx.execute(
        "INSERT INTO migration_history (migration_key, source_hash) VALUES (?, ?)",
        [MIGRATION_KEY, sourceHash],
      );
    });

    return { sqlitePath, sourceHash, counts: sourceCounts };
  } finally {
    source.close();
    if (db) await db.close();
  }
}

if (require.main === module) {
  runMigration()
    .then((result) => {
      console.log("[migration] SQLite import to Supabase PostgreSQL completed and verified:");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error("[migration] SQLite import failed:", error.message);
      if (error.rollbackError) {
        console.error("[migration] Rollback also failed:", error.rollbackError.message);
      }
      process.exitCode = 1;
    });
}

module.exports = {
  getInconsistentRelationships,
  getMissingRelationships,
  getSqlitePath,
  runMigration,
};
