import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";
import { tables, manifest, type LegacyExport } from "../domain/migration";
const [account, database, file, freeze] = process.argv.slice(2);
if (!account || !database || !file || freeze !== "--writes-frozen")
  throw new Error(
    "Usage: export-d1 <account> <database> private/export.json --writes-frozen. Freeze old writes separately before invoking.",
  );
const destination = resolve(file),
  privateRoot = resolve("private");
if (!destination.startsWith(privateRoot + sep))
  throw new Error("Export must stay in the ignored private directory");
if (!process.env.CLOUDFLARE_API_TOKEN)
  throw new Error(
    "Set an owner-authorized read-only D1 API token in the process environment",
  );
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
if (process.platform === "win32")
  execFileSync(
    "icacls",
    [
      dirname(destination),
      "/inheritance:r",
      "/grant:r",
      `${userInfo().username}:(OI)(CI)F`,
    ],
    { stdio: "ignore" },
  );
const query = async (sql: string, params: unknown[] = []) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const data: any = await response.json();
  if (!response.ok || !data.success)
    throw new Error("Private D1 export failed");
  return data.result[0].results as any[];
};
const schema = await query(
  "SELECT type,name,tbl_name AS tableName,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
);
const exported: LegacyExport = {
  format: "liftline-d1-backup-v1",
  createdAt: new Date().toISOString(),
  schema,
  tables: [],
};
for (const name of tables) {
  const count = Number(
    (await query(`SELECT COUNT(*) AS count FROM ${name}`))[0].count,
  );
  const rows = [];
  for (let offset = 0; offset < count; offset += 100)
    rows.push(
      ...(await query(`SELECT * FROM ${name} ORDER BY id LIMIT 100 OFFSET ?`, [
        offset,
      ])),
    );
  if (
    rows.length !== count ||
    Number((await query(`SELECT COUNT(*) AS count FROM ${name}`))[0].count) !==
      count
  )
    throw new Error("Export changed during read; keep writes frozen and retry");
  exported.tables.push({ name, rows });
}
await writeFile(destination, JSON.stringify(exported), { mode: 0o600 });
await writeFile(
  `${destination}.manifest.json`,
  JSON.stringify(manifest(exported), null, 2),
  { mode: 0o600 },
);
console.log("Private export and checksum manifest written.");
