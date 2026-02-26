/**
 * SQLite database for the build queue.
 *
 * Uses bun:sqlite with WAL mode for concurrent reads during writes.
 * All queries use prepared statements for performance.
 */

import { Database } from "bun:sqlite";
import type { BuildJob, BuildStatus } from "./types.ts";

/** Raw row shape returned from SQLite (snake_case columns). */
interface BuildRow {
  readonly id: string;
  readonly settings_hash: string;
  readonly settings_json: string;
  readonly status: string;
  readonly error: string | null;
  readonly created_at: number;
  readonly started_at: number | null;
  readonly completed_at: number | null;
  readonly material_count: number | null;
  readonly archive_size: number | null;
}

/** Result of an atomic insert-or-find operation. */
export interface InsertOrFindResult {
  readonly job: BuildJob;
  readonly inserted: boolean;
}

/** Typed database query interface. */
export interface BuildDatabase {
  readonly insertOrFindByHash: (
    id: string,
    settingsHash: string,
    settingsJson: string,
  ) => InsertOrFindResult;
  readonly findById: (id: string) => BuildJob | null;
  readonly claimNextPending: () => BuildJob | null;
  readonly completeBuild: (
    id: string,
    archive: Uint8Array,
    materialCount: number,
  ) => void;
  readonly failBuild: (id: string, error: string) => void;
  readonly getArchive: (id: string) => Uint8Array | null;
  readonly listBuilds: (limit: number, offset: number) => readonly BuildJob[];
  readonly countTotal: () => number;
  readonly countByStatus: (status: BuildStatus) => number;
  readonly evictOldBuilds: (maxKeep: number) => number;
  readonly close: () => void;
}

const VALID_STATUSES = new Set<string>(["pending", "building", "completed", "failed"]);

function assertBuildStatus(s: string): BuildStatus {
  if (!VALID_STATUSES.has(s)) {
    throw new Error(`Invalid build status in database: "${s}"`);
  }
  return s as BuildStatus;
}

function rowToJob(row: BuildRow): BuildJob {
  return {
    id: row.id,
    settingsHash: row.settings_hash,
    settingsJson: row.settings_json,
    status: assertBuildStatus(row.status),
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    materialCount: row.material_count,
    archiveSize: row.archive_size,
  };
}

/**
 * Open (or create) the SQLite database and prepare all statements.
 *
 * @param dbPath - File path for the database (use ":memory:" for tests)
 */
export function createDatabase(dbPath: string): BuildDatabase {
  const db = new Database(dbPath, { create: true });

  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      settings_hash TEXT NOT NULL,
      settings_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      archive BLOB,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      material_count INTEGER,
      archive_size INTEGER
    )
  `);

  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_builds_hash ON builds(settings_hash)",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_builds_created ON builds(created_at DESC)",
  );

  // Reset any builds that were interrupted mid-flight (e.g., server crash)
  db.exec("UPDATE builds SET status = 'pending' WHERE status = 'building'");

  const stmtInsert = db.prepare<void, [string, string, string, number]>(
    `INSERT INTO builds (id, settings_hash, settings_json, created_at)
     VALUES (?, ?, ?, ?)`,
  );

  const stmtFindByHash = db.prepare<BuildRow, [string]>(
    `SELECT id, settings_hash, settings_json, status, error,
            created_at, started_at, completed_at, material_count, archive_size
     FROM builds
     WHERE settings_hash = ? AND status IN ('pending', 'building', 'completed')
     ORDER BY created_at DESC
     LIMIT 1`,
  );

  const stmtFindById = db.prepare<BuildRow, [string]>(
    `SELECT id, settings_hash, settings_json, status, error,
            created_at, started_at, completed_at, material_count, archive_size
     FROM builds WHERE id = ?`,
  );

  const stmtClaimPending = db.prepare<BuildRow, [number]>(
    `UPDATE builds
     SET status = 'building', started_at = ?
     WHERE id = (
       SELECT id FROM builds WHERE status = 'pending'
       ORDER BY created_at ASC LIMIT 1
     )
     RETURNING id, settings_hash, settings_json, status, error,
               created_at, started_at, completed_at, material_count, archive_size`,
  );

  const stmtComplete = db.prepare<void, [Uint8Array, number, number, number, string]>(
    `UPDATE builds
     SET status = 'completed', archive = ?, completed_at = ?,
         material_count = ?, archive_size = ?
     WHERE id = ?`,
  );

  const stmtFail = db.prepare<void, [string, number, string]>(
    `UPDATE builds SET status = 'failed', error = ?, completed_at = ?
     WHERE id = ?`,
  );

  const stmtGetArchive = db.prepare<{ archive: Uint8Array | null }, [string]>(
    "SELECT archive FROM builds WHERE id = ? AND status = 'completed'",
  );

  const stmtList = db.prepare<BuildRow, [number, number]>(
    `SELECT id, settings_hash, settings_json, status, error,
            created_at, started_at, completed_at, material_count, archive_size
     FROM builds ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  );

  const stmtCountTotal = db.prepare<{ count: number }, []>(
    "SELECT COUNT(*) as count FROM builds",
  );

  const stmtCountByStatus = db.prepare<{ count: number }, [string]>(
    "SELECT COUNT(*) as count FROM builds WHERE status = ?",
  );

  const stmtEvict = db.prepare<void, [number]>(
    `DELETE FROM builds WHERE id IN (
       SELECT id FROM builds WHERE status = 'completed'
       ORDER BY completed_at ASC
       LIMIT MAX(0, (SELECT COUNT(*) FROM builds WHERE status = 'completed') - ?)
     )`,
  );

  // CRITICAL: Atomic check-and-insert prevents TOCTOU race on deduplication.
  // SQLite transactions are serialized (single-writer guarantee).
  const txInsertOrFind = db.transaction(
    (id: string, hash: string, json: string): InsertOrFindResult => {
      const existing = stmtFindByHash.get(hash);
      if (existing) return { job: rowToJob(existing), inserted: false };

      stmtInsert.run(id, hash, json, Date.now());
      const created = stmtFindById.get(id);
      if (!created) throw new Error("Failed to read back inserted build row");
      return { job: rowToJob(created), inserted: true };
    },
  );

  return {
    insertOrFindByHash(id, settingsHash, settingsJson) {
      return txInsertOrFind(id, settingsHash, settingsJson);
    },

    findById(id) {
      const row = stmtFindById.get(id);
      return row ? rowToJob(row) : null;
    },

    claimNextPending() {
      const row = stmtClaimPending.get(Date.now());
      return row ? rowToJob(row) : null;
    },

    completeBuild(id, archive, materialCount) {
      const now = Date.now();
      stmtComplete.run(archive, now, materialCount, archive.length, id);
    },

    failBuild(id, error) {
      stmtFail.run(error, Date.now(), id);
    },

    getArchive(id) {
      const row = stmtGetArchive.get(id);
      return row?.archive ?? null;
    },

    listBuilds(limit, offset) {
      return stmtList.all(limit, offset).map(rowToJob);
    },

    countTotal() {
      return stmtCountTotal.get()?.count ?? 0;
    },

    countByStatus(status) {
      return stmtCountByStatus.get(status)?.count ?? 0;
    },

    evictOldBuilds(maxKeep) {
      const result = stmtEvict.run(maxKeep);
      return result.changes;
    },

    close() {
      db.close();
    },
  };
}
