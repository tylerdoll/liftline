import {
  BACKUP_PREFIX,
  backupObjectKey,
  expiredBackupKeys,
} from "./backup-retention";

export interface DatabaseBackupEnv {
  DB: D1Database;
  BACKUPS: R2Bucket;
}

interface SchemaRow {
  type: "table" | "index" | "trigger" | "view";
  name: string;
  tableName: string;
  sql: string | null;
}

export interface DatabaseBackupResult {
  key: string;
  createdAt: string;
  tableCount: number;
  deletedExpiredBackupCount: number;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function listAllBackups(bucket: R2Bucket): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;

  do {
    const page = await bucket.list({
      prefix: BACKUP_PREFIX,
      cursor,
      include: ["customMetadata"],
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return objects;
}

export async function createDatabaseBackup(
  env: DatabaseBackupEnv,
  backupTime = Date.now(),
): Promise<DatabaseBackupResult> {
  const createdAt = new Date(backupTime).toISOString();
  const schema = await env.DB.prepare(`SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_schema
    WHERE type IN ('table', 'index', 'trigger', 'view')
      AND sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%'
      AND lower(substr(name, 1, 4)) != '_cf_'
    ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'view' THEN 3 ELSE 4 END, name`).all<SchemaRow>();

  const userTables = schema.results.filter((item) => item.type === "table");
  const tableResults = userTables.length
    ? await env.DB.batch(
        userTables.map((table) =>
          env.DB.prepare(`SELECT * FROM ${quoteIdentifier(table.name)}`),
        ),
      )
    : [];

  const snapshot = {
    format: "liftline-d1-backup-v1",
    createdAt,
    schema: schema.results,
    tables: userTables.map((table, index) => ({
      name: table.name,
      rows: tableResults[index]?.results ?? [],
    })),
  };
  const key = backupObjectKey(createdAt);

  await env.BACKUPS.put(key, JSON.stringify(snapshot), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { createdAt, format: snapshot.format },
  });

  const backups = await listAllBackups(env.BACKUPS);
  const expired = expiredBackupKeys(backups, backupTime);

  if (expired.length) {
    await env.BACKUPS.delete(expired);
  }

  return {
    key,
    createdAt,
    tableCount: userTables.length,
    deletedExpiredBackupCount: expired.length,
  };
}
