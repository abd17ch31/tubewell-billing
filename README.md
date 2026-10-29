# Tubewell Billing

## Supabase configuration

Supabase provides PostgreSQL. The server connects directly to the Supabase database using the PostgreSQL connection string; it does not use a Supabase API key or the Supabase JavaScript API. Do not send API keys for this app. The `anon`/publishable key and `service_role`/secret key are not database passwords and should never be pasted into source files or chat.

1. In Supabase, create or open a project.
2. Open **Connect** in the project dashboard and copy a PostgreSQL connection string for the server. For this long-running Node server, choose the **Session pooler** connection string if the direct endpoint is not reachable over IPv4. Use the database password from project setup (reset it from the dashboard if needed).
3. Paste the complete connection URL into the ignored root `.env` file as `SUPABASE_DB_URL`. The `.env.example` contains a placeholder to show where it goes. Do not commit `.env` or share its contents.
4. If Node reports a certificate error such as `self-signed certificate in certificate chain`, download the project's server root certificate from **Project Settings → Database → SSL Configuration**. Save it as `supabase-root.crt` in the repository root and set `SUPABASE_DB_SSL_CA=./supabase-root.crt` in `.env`. The app continues to verify the server certificate; do not disable TLS verification.

The server creates its application tables and default settings when it starts. It does not listen until a PostgreSQL connection succeeds, and it does not fall back to SQLite or MySQL. Keep using `npm start` for production and `npm run dev` for watch mode.

Fly.io does not provide a database through the app's former `/data` volume. Configure Fly to reach the Supabase database and set `SUPABASE_DB_URL` as a Fly secret/environment variable. No Fly volume is required by the app.

## Import the existing SQLite database

The importer reads `data/tubewell.db` locally, or `/data/tubewell.db` when `NODE_ENV=production`; set `SQLITE_PATH` to use another source file. It opens SQLite read-only and leaves the source file unchanged. SQLite WAL sidecar files are read through SQLite, so keep the original database and any `-wal`/`-shm` files together during import.

If the live Fly.io app has records on its `/data` volume, export the database and its WAL sidecars to a trusted machine before deploying the configuration that removes the mount. Stop app writes or use a consistent SQLite backup while exporting, and do not remove the old volume until the import has been verified.

1. Create a Supabase project and copy its PostgreSQL connection URL. The target database must be empty; do not point the importer at a Supabase database that already contains app records.
2. Add `SUPABASE_DB_URL` to `.env`. Use the connection string from the dashboard, not an API key.
3. Install dependencies, including the migration-only SQLite reader: `npm ci`.
4. Run `npm run migrate:sqlite` from the repository root before starting the app.

The import preserves each table's IDs and relationships, runs the data import in a transaction, resets PostgreSQL identity sequences, and verifies destination row counts and relationships. It refuses to import if any business table already has rows. A `migration_history` marker prevents a successful import from being rerun, including when the source tables are empty. On failure, the transaction is rolled back; the original SQLite database is never modified. The importer does not delete or overwrite target data.

Keep a separate backup of the SQLite source until the imported Supabase data has been checked.

## Tests

Run the project tests with `npm test`.
