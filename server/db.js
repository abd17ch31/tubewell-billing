const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

const REQUIRED_TABLES = [
  "customers",
  "bills",
  "payments",
  "payment_allocations",
  "settings",
  "notebook_dues",
  "notebook_allocations",
];

types.setTypeParser(20, Number);
types.setTypeParser(1114, (value) => value);

function getConnectionOptions(env = process.env) {
  const connectionString = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required Supabase database configuration: SUPABASE_DB_URL");
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("SUPABASE_DB_URL must be a valid PostgreSQL connection URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("SUPABASE_DB_URL must use the postgres:// or postgresql:// scheme");
  }
  if (!url.hostname || !url.username || !url.pathname || url.pathname === "/") {
    throw new Error("SUPABASE_DB_URL must include a host, username, and database name");
  }

  let ca;
  if (env.SUPABASE_DB_SSL_CA) {
    const caPath = path.resolve(env.SUPABASE_DB_SSL_CA);
    try {
      ca = fs.readFileSync(caPath, "utf8");
    } catch (error) {
      throw new Error(`Could not read Supabase root certificate at ${caPath}: ${error.message}`);
    }
  }

  return {
    connectionString,
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
}

function toPostgresSql(sql) {
  let index = 0;
  return sql
    .replace(/`/g, '"')
    .replace(/\?/g, () => `$${++index}`);
}

function createDatabase(pool) {
  const getPool = typeof pool === "function" ? pool : () => pool;
  const queryWith = async (client, sql, values = []) => client.query(toPostgresSql(sql), values);

  return {
    async query(sql, values = []) {
      const result = await queryWith(getPool(), sql, values);
      return result.rows;
    },

    async execute(sql, values = []) {
      const result = await queryWith(getPool(), sql, values);
      return {
        insertId: result.rows[0] && result.rows[0].id,
        affectedRows: result.rowCount,
        rows: result.rows,
      };
    },

    async transaction(callback) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const transaction = {
          query: async (sql, values = []) => (await queryWith(client, sql, values)).rows,
          execute: async (sql, values = []) => {
            const result = await queryWith(client, sql, values);
            return {
              insertId: result.rows[0] && result.rows[0].id,
              affectedRows: result.rowCount,
              rows: result.rows,
            };
          },
        };
        const result = await callback(transaction);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          error.rollbackError = rollbackError;
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async initialize({ seedDefaults = true } = {}) {
      const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
      const statements = schema.split(";").map((statement) => statement.trim()).filter(Boolean);

      for (const statement of statements) {
        await getPool().query(statement);
      }

      if (seedDefaults) {
        const defaults = {
          business_name: "Tubewell Billing",
          business_address: "",
          receipt_footer: "Thank you.",
          default_rate_paise: String(process.env.DEFAULT_RATE_PAISE || 8000),
        };
        for (const [key, value] of Object.entries(defaults)) {
          await this.execute(
            'INSERT INTO settings ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO NOTHING',
            [key, value],
          );
        }
      }
    },

    async close() {
      if (typeof pool === "function") return;
      if (pool) await pool.end();
    },
  };
}

let pool;
const getPool = () => {
  if (!pool) pool = new Pool(getConnectionOptions());
  return pool;
};
const db = createDatabase(getPool);

async function initializeDatabase(options) {
  const client = await getPool().connect();
  client.release();
  await db.initialize(options);
  console.log("[db] Supabase PostgreSQL connection ready");
}

module.exports = {
  ...db,
  createDatabase,
  getConnectionOptions,
  initializeDatabase,
  REQUIRED_TABLES,
  toPostgresSql,
};
