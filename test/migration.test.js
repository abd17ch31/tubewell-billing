const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");
const { getInconsistentRelationships, runMigration } = require("../scripts/migrate-sqlite-to-supabase");

const TABLES = {
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

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tubewell-migration-"));
  const sqlitePath = path.join(directory, "source.db");
  const source = new Database(sqlitePath);
  source.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, mobile TEXT, address TEXT, created_at TEXT, is_active INTEGER);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, customer_id INTEGER, bill_date TEXT, start_time TEXT, end_time TEXT, usage_minutes INTEGER, rate_paise_per_hour INTEGER, amount_paise INTEGER, previous_due_paise INTEGER, total_due_paise INTEGER, created_at TEXT);
    CREATE TABLE payments (id INTEGER PRIMARY KEY, customer_id INTEGER, payment_date TEXT, amount_paise INTEGER, mode TEXT, note TEXT, created_at TEXT);
    CREATE TABLE payment_allocations (id INTEGER PRIMARY KEY, payment_id INTEGER, bill_id INTEGER, amount_paise INTEGER, created_at TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
    CREATE TABLE notebook_dues (id INTEGER PRIMARY KEY, customer_id INTEGER, due_date TEXT, amount_paise INTEGER, note TEXT, created_at TEXT);
    CREATE TABLE notebook_allocations (id INTEGER PRIMARY KEY, payment_id INTEGER, notebook_due_id INTEGER, amount_paise INTEGER, created_at TEXT);
  `);
  const rows = {
    customers: [[1, "A Customer", "1234567890", null, "2024-01-01 00:00:00", 1]],
    bills: [[1, 1, "2024-01-01", "09:00", "10:00", 60, 8000, 8000, 0, 8000, "2024-01-01 00:00:00"]],
    payments: [[1, 1, "2024-01-02", 3000, "cash", null, "2024-01-02 00:00:00"]],
    payment_allocations: [[1, 1, 1, 1000, "2024-01-02 00:00:00"]],
    settings: [["business_name", "Tubewell Billing", "2024-01-01 00:00:00"]],
    notebook_dues: [[1, 1, "2024-01-01", 2000, "note", "2024-01-01 00:00:00"]],
    notebook_allocations: [[1, 1, 1, 2000, "2024-01-02 00:00:00"]],
  };

  for (const [table, tableRows] of Object.entries(rows)) {
    const columns = TABLES[table];
    const sql = `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    const insert = source.prepare(sql);
    for (const row of tableRows) insert.run(row);
  }
  source.close();
  return { directory, sqlitePath, rows };
}

function createFakePool(initialTables = {}, { failOnTable } = {}) {
  let tables = structuredClone(initialTables);

  function execute(state, sql, values = []) {
    const migration = sql.match(/SELECT migration_key FROM migration_history WHERE migration_key = \$1/);
    if (migration) {
      return { rows: [...(state.migration_history || []).filter((row) => row.migration_key === values[0])], rowCount: 1 };
    }
    const count = sql.match(/SELECT COUNT\(\*\) AS count FROM "?(\w+)"?/);
    if (count) return { rows: [{ count: (state[count[1]] || []).length }], rowCount: 1 };
    const relationship = sql.match(/FROM "?(\w+)"? AS c\s+LEFT JOIN "?(\w+)"? AS p ON p\.id = c\."?(\w+)"?/);
    if (relationship) {
      const [, child, parent, column] = relationship;
      const parentIds = new Set((state[parent] || []).map((row) => row.id));
      const missing = (state[child] || []).filter((row) => row[column] !== null && !parentIds.has(row[column])).length;
      return { rows: [{ count: missing }], rowCount: 1 };
    }
    const consistency = sql.match(/FROM (payment_allocations|notebook_allocations) AS a/);
    if (consistency) {
      const allocations = state[consistency[1]] || [];
      const payments = new Map((state.payments || []).map((row) => [row.id, row]));
      const relatedTable = consistency[1] === "payment_allocations" ? "bills" : "notebook_dues";
      const relatedId = consistency[1] === "payment_allocations" ? "bill_id" : "notebook_due_id";
      const related = new Map((state[relatedTable] || []).map((row) => [row.id, row]));
      const mismatchCount = allocations.filter((allocation) => (
        payments.get(allocation.payment_id)?.customer_id !== related.get(allocation[relatedId])?.customer_id
      )).length;
      return { rows: [{ count: mismatchCount }], rowCount: 1 };
    }
    if (sql.includes("setval(")) return { rows: [], rowCount: 1 };
    const insert = sql.match(/INSERT INTO "?(\w+)"? \((.+)\) VALUES \(/);
    if (insert) {
      const [, table, columnSql] = insert;
      if (table === failOnTable) throw new Error(`Simulated insert failure: ${table}`);
      const columns = columnSql.split(",").map((column) => column.trim().replace(/^["`]|["`]$/g, ""));
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      if (!state[table]) state[table] = [];
      state[table].push(row);
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unsupported fake PostgreSQL query: ${sql}`);
  }

  return {
    async query(sql, values) {
      const table = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
      if (table) {
        if (!tables[table[1]]) tables[table[1]] = [];
        return { rows: [], rowCount: 0 };
      }
      if (/^CREATE INDEX/i.test(sql)) return { rows: [], rowCount: 0 };
      return execute(tables, sql, values);
    },
    async connect() {
      let transactionTables;
      return {
        async query(sql, values) {
          if (sql === "BEGIN") {
            transactionTables = structuredClone(tables);
            return { rows: [], rowCount: 0 };
          }
          if (sql === "COMMIT") {
            tables = transactionTables;
            return { rows: [], rowCount: 0 };
          }
          if (sql === "ROLLBACK") {
            transactionTables = undefined;
            return { rows: [], rowCount: 0 };
          }
          return execute(transactionTables, sql, values);
        },
        release() {},
      };
    },
    async end() {},
    get tables() { return tables; },
  };
}

test("SQLite migration preserves rows and relationships and refuses a rerun", async () => {
  const fixture = createFixture();
  const pool = createFakePool();
  const originalBytes = fs.readFileSync(fixture.sqlitePath);
  try {
    const result = await runMigration({ sqlitePath: fixture.sqlitePath, pool });
    assert.equal(result.counts.customers, 1);
    assert.equal(result.counts.payment_allocations, 1);
    assert.deepEqual(pool.tables.customers[0], {
      id: 1,
      name: "A Customer",
      mobile: "1234567890",
      address: null,
      created_at: "2024-01-01 00:00:00",
      is_active: 1,
    });
    assert.equal(pool.tables.payment_allocations[0].payment_id, 1);
    assert.equal(pool.tables.notebook_allocations[0].notebook_due_id, 1);
    assert.equal(pool.tables.migration_history.length, 1);
    assert.deepEqual(fs.readFileSync(fixture.sqlitePath), originalBytes);
    await assert.rejects(
      runMigration({ sqlitePath: fixture.sqlitePath, pool }),
      /already completed/,
    );
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("SQLite migration rolls back every imported row when an insert fails", async () => {
  const fixture = createFixture();
  const pool = createFakePool({}, { failOnTable: "payments" });
  try {
    await assert.rejects(
      runMigration({ sqlitePath: fixture.sqlitePath, pool }),
      /Simulated insert failure/,
    );
    assert.equal(pool.tables.customers.length, 0);
    assert.equal(pool.tables.bills.length, 0);
    assert.equal(pool.tables.migration_history.length, 0);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("migration detects allocations that link different customers", () => {
  const problems = getInconsistentRelationships({
    payments: [{ id: 1, customer_id: 1 }],
    bills: [{ id: 1, customer_id: 2 }],
    notebook_dues: [{ id: 1, customer_id: 1 }],
    payment_allocations: [{ payment_id: 1, bill_id: 1 }],
    notebook_allocations: [{ payment_id: 1, notebook_due_id: 1 }],
  });
  assert.deepEqual(problems, [{
    table: "payment_allocations",
    relationship: "payment/bill customer",
    inconsistent: 1,
  }]);
});

test("SQLite migration refuses a populated Supabase database without inserting", async () => {
  const fixture = createFixture();
  const pool = createFakePool({ customers: [{ id: 99 }] });
  try {
    await assert.rejects(
      runMigration({ sqlitePath: fixture.sqlitePath, pool }),
      /Supabase database is not empty/,
    );
    assert.deepEqual(pool.tables.customers, [{ id: 99 }]);
    assert.equal(pool.tables.bills.length, 0);
    assert.equal(pool.tables.migration_history.length, 0);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});
