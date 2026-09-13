import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Failure, type Item, type Store, type Write } from "../domain/store";
export class DynamoStore implements Store {
  readonly client: DynamoDBDocumentClient;
  constructor(
    readonly table: string,
    endpoint?: string,
  ) {
    if (endpoint && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(endpoint))
      throw new Error("Emulator must be localhost");
    this.client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: "us-west-2",
        ...(endpoint
          ? {
              endpoint,
              credentials: {
                accessKeyId: "testing",
                secretAccessKey: "testing",
              },
            }
          : {}),
      }),
      { marshallOptions: { removeUndefinedValues: true } },
    );
  }
  async get(PK: string, SK: string) {
    return (
      await this.client.send(
        new GetCommand({
          TableName: this.table,
          Key: { PK, SK },
          ConsistentRead: true,
        }),
      )
    ).Item as Item | undefined;
  }
  async query(
    PK: string,
    prefix: string,
    cursor?: string,
    limit = 50,
    descending = false,
  ) {
    let start;
    try {
      start = cursor
        ? JSON.parse(Buffer.from(cursor, "base64url").toString())
        : undefined;
    } catch {
      throw new Failure(400, "Invalid cursor");
    }
    if (
      start &&
      (start.PK !== PK ||
        typeof start.SK !== "string" ||
        !start.SK.startsWith(prefix))
    )
      throw new Failure(400, "Invalid cursor");
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: prefix
          ? "PK = :p AND begins_with(SK, :s)"
          : "PK = :p",
        ExpressionAttributeValues: prefix
          ? { ":p": PK, ":s": prefix }
          : { ":p": PK },
        ConsistentRead: true,
        Limit: Math.min(100, limit),
        ScanIndexForward: !descending,
        ExclusiveStartKey: start,
      }),
    );
    return {
      items: (r.Items as Item[]) ?? [],
      cursor: r.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64url")
        : undefined,
    };
  }
  async expired(now: number, cursor?: string) {
    const r = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "Expiry",
        KeyConditionExpression: "expiryPK = :p AND expirySK <= :n",
        ExpressionAttributeValues: { ":p": "DRAFT", ":n": now },
        Limit: 50,
        ExclusiveStartKey: cursor
          ? JSON.parse(Buffer.from(cursor, "base64url").toString())
          : undefined,
      }),
    );
    return {
      items: (r.Items as Item[]) ?? [],
      cursor: r.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString("base64url")
        : undefined,
    };
  }
  async transact(writes: Write[]) {
    if (
      writes.length > 100 ||
      Buffer.byteLength(JSON.stringify(writes)) > 4 * 1024 * 1024
    )
      throw new Failure(413, "Transaction too large");
    const keys = writes.map((w) =>
      "put" in w ? w.put : "check" in w ? w.check : w.update,
    );
    if (new Set(keys.map((k) => `${k.PK}\0${k.SK}`)).size !== keys.length)
      throw new Error("Duplicate transaction key");
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: writes.map((w) => {
            const c =
              "condition" in w && w.condition
                ? {
                    ConditionExpression: w.condition.expression,
                    ExpressionAttributeNames: w.condition.names,
                    ExpressionAttributeValues: w.condition.values,
                  }
                : {};
            if ("put" in w)
              return { Put: { TableName: this.table, Item: w.put, ...c } };
            if ("check" in w)
              return {
                ConditionCheck: {
                  TableName: this.table,
                  Key: w.check,
                  ...c,
                  ConditionExpression: w.condition.expression,
                },
              };
            return {
              Update: {
                TableName: this.table,
                Key: w.update,
                UpdateExpression: w.expression,
                ExpressionAttributeNames: w.names,
                ExpressionAttributeValues: w.values,
              },
            };
          }),
        }),
      );
    } catch (e: any) {
      if (
        e.name === "TransactionCanceledException" &&
        e.CancellationReasons?.some(
          (r: any) => r.Code === "ConditionalCheckFailed",
        )
      )
        throw new Failure(409, "Revision or operation conflict");
      throw e;
    }
  }
}
