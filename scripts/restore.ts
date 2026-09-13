import {
  CreateBackupCommand,
  RestoreTableFromBackupCommand,
  DescribeTableCommand,
  UpdateContinuousBackupsCommand,
} from "@aws-sdk/client-dynamodb";
import { BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoStore } from "../api/dynamo";
import { S3Archive } from "../api/archive";
import { rebuildDerived, type Archive } from "../domain/migration";
import { hash } from "../domain/service";
export async function restoreDrill(
  source: DynamoStore,
  archive: Archive,
  targetName: string,
  owners: string[],
) {
  if (!/^restore-[a-z0-9-]+$/.test(targetName) || targetName === source.table)
    throw new Error("Restore target must be a new restore-* table");
  const start = Date.now();
  const backup = await source.client.send(
    new CreateBackupCommand({
      TableName: source.table,
      BackupName: `drill-${Date.now()}`,
    }),
  );
  await source.client.send(
    new RestoreTableFromBackupCommand({
      TargetTableName: targetName,
      BackupArn: backup.BackupDetails!.BackupArn!,
    }),
  );
  const endpoint = await source.client.config.endpoint?.();
  const local =
    endpoint?.hostname === "127.0.0.1"
      ? `http://127.0.0.1:${endpoint.port}`
      : undefined;
  const target = new DynamoStore(targetName, local);
  for (let attempt = 0; attempt < 120; attempt++) {
    const r = await target.client.send(
      new DescribeTableCommand({ TableName: targetName }),
    );
    if (r.Table?.TableStatus === "ACTIVE") break;
    if (attempt === 119) throw new Error("Restore timed out");
    await new Promise((r) => setTimeout(r, 5000));
  }
  const records = async (store: DynamoStore, owner: string, prefix = "") => {
    let cursor;
    const result = [];
    do {
      const page = await store.query(`USER#${owner}`, prefix, cursor, 100);
      result.push(...page.items);
      cursor = page.cursor;
    } while (cursor);
    return result;
  };
  const reports = [];
  for (const owner of owners) {
    const canonical = (items: any[]) =>
      items
        .filter(
          (i) =>
            !["HISTORY#", "PROGRESS#", "WEEK#", "REBUILD#"].some((prefix) =>
              i.SK.startsWith(prefix),
            ),
        )
        .sort((a, b) => a.SK.localeCompare(b.SK));
    const before = canonical(await records(source, owner)),
      after = canonical(await records(target, owner));
    if (hash(JSON.stringify(before)) !== hash(JSON.stringify(after)))
      throw new Error("Canonical restore checksum mismatch");
    for (const prefix of ["HISTORY#", "PROGRESS#", "WEEK#", "REBUILD#"]) {
      const items = await records(target, owner, prefix);
      for (let i = 0; i < items.length; i += 25) {
        let pending: any = {
          [targetName]: items
            .slice(i, i + 25)
            .map(({ PK, SK }) => ({ DeleteRequest: { Key: { PK, SK } } })),
        };
        for (let attempt = 0; Object.keys(pending).length; attempt++) {
          if (attempt >= 10)
            throw new Error(
              "Restore projection clearing throttled; retry drill before switching",
            );
          const result = await target.client.send(
            new BatchWriteCommand({ RequestItems: pending }),
          );
          pending = result.UnprocessedItems ?? {};
          if (Object.keys(pending).length)
            await new Promise((r) =>
              setTimeout(r, Math.min(5000, 100 * 2 ** attempt)),
            );
        }
      }
    }
    const rebuilt = await rebuildDerived(target, archive, owner);
    reports.push({
      owner,
      canonicalRecords: before.length,
      checksum: hash(JSON.stringify(before)),
      rebuilt,
    });
  }
  await target.client.send(
    new UpdateContinuousBackupsCommand({
      TableName: targetName,
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
        RecoveryPeriodInDays: 35,
      },
    }),
  );
  return {
    target: targetName,
    elapsedMs: Date.now() - start,
    owners: reports,
    remainingChecks: [
      "Cognito identity binding and IAM enforcement",
      "archive access in recovery account",
      "application runtime table switch",
      "real AWS RPO measurement",
    ],
  };
}
if (process.argv[1]?.endsWith("restore.ts")) {
  const [source, target, bucket, ...owners] = process.argv.slice(2);
  if (!source || !target || !bucket || !owners.length)
    throw new Error(
      "Usage: restore <source-table> <new-restore-table> <archive-bucket> <owner-ids...>",
    );
  const report = await restoreDrill(
    new DynamoStore(source),
    new S3Archive(bucket),
    target,
    owners,
  );
  console.log(JSON.stringify(report));
}
