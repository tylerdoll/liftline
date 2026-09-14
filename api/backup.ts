import {
  DynamoDBClient,
  ExportTableToPointInTimeCommand,
  DescribeExportCommand,
} from "@aws-sdk/client-dynamodb";
import { DynamoStore } from "./dynamo";
export async function handler(event?: { monitor?: boolean }) {
  const store = new DynamoStore(process.env.TABLE_NAME!);
  const client = new DynamoDBClient({ region: "us-east-2" });
  if (event?.monitor) {
    const latest = await store.get("SYSTEM", "BACKUP_STATUS");
    if (!latest) throw new Error("No weekly export has been recorded");
    const result = await client.send(
      new DescribeExportCommand({ ExportArn: latest.arn }),
    );
    const status = result.ExportDescription?.ExportStatus;
    if (
      status === "FAILED" ||
      (status !== "COMPLETED" && Date.now() - latest.startedAt > 6 * 3600000) ||
      Date.now() - latest.startedAt > 8 * 86400000
    )
      throw new Error("Weekly export failed or overdue");
    return { status };
  }
  const now = new Date(),
    week = now.toISOString().slice(0, 10);
  const result = await client.send(
    new ExportTableToPointInTimeCommand({
      TableArn: process.env.TABLE_ARN!,
      S3Bucket: process.env.RECOVERY_BUCKET!,
      S3BucketOwner: process.env.RECOVERY_ACCOUNT!,
      S3Prefix: `weekly/${week}`,
      ExportFormat: "DYNAMODB_JSON",
      ExportType: "FULL_EXPORT",
      S3SseAlgorithm: "AES256",
      ClientToken: `weekly-${week}`,
    }),
  );
  await store.transact([
    {
      put: {
        PK: "SYSTEM",
        SK: "BACKUP_STATUS",
        arn: result.ExportDescription!.ExportArn!,
        startedAt: Date.now(),
      },
    },
  ]);
  console.log(JSON.stringify({ event: "weekly_export_started" }));
}
