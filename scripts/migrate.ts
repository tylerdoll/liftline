import { readFile, writeFile } from "node:fs/promises";
import { DynamoStore } from "../api/dynamo";
import { S3Archive } from "../api/archive";
import { importLegacy, rebuildDerived, manifest } from "../domain/migration";
const [file, owner, table, bucket, report] = process.argv.slice(2);
if (!file || !owner || !table || !bucket || !report)
  throw new Error(
    "Usage: migrate <private-export.json> <internal-owner-id> <isolated-table> <private-archive-bucket> <private-report.json>",
  );
const data = JSON.parse(await readFile(file, "utf8"));
manifest(data);
const store = new DynamoStore(table),
  archive = new S3Archive(bucket);
const first = await importLegacy(store, archive, owner, data),
  derived = await rebuildDerived(store, archive, owner);
const second = await importLegacy(store, archive, owner, data),
  third = await importLegacy(store, archive, owner, data);
if (second.written || third.written)
  throw new Error("Import is not idempotent");
await writeFile(
  report,
  JSON.stringify({ first, second, third, derived }, null, 2),
  { mode: 0o600 },
);
console.log(
  "Private migration report written. Review quarantine and reconcile before enabling the owner.",
);
