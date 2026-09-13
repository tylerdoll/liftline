import {
  CreateTableCommand,
  DeleteTableCommand,
} from "@aws-sdk/client-dynamodb";
import { randomUUID } from "node:crypto";
import { DynamoStore } from "../../api/dynamo";
import { Service, metadata } from "../../domain/service";
export async function awsFixture() {
  const table = `test-${randomUUID()}`,
    store = new DynamoStore(table, "http://127.0.0.1:5000");
  await store.client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "expiryPK", AttributeType: "S" },
        { AttributeName: "expirySK", AttributeType: "N" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "Expiry",
          KeySchema: [
            { AttributeName: "expiryPK", KeyType: "HASH" },
            { AttributeName: "expirySK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "KEYS_ONLY" },
        },
      ],
    }),
  );
  let now = Date.parse("2040-06-10T16:00:00Z");
  const service = new Service(store, () => now);
  for (const uid of ["alice", "bob"])
    await store.transact([
      {
        put: {
          PK: `USER#${uid}`,
          SK: "PROFILE",
          id: uid,
          enabled: true,
          timezone: "America/Denver",
          activePlanId: null,
          ...metadata(now),
        },
      },
      { put: { PK: `IDENTITY#test#${uid}`, SK: "PROFILE", userId: uid } },
    ]);
  await store.transact([
    {
      put: {
        PK: "CATALOG",
        SK: "EXERCISE#builtin-press",
        id: "builtin-press",
        name: "Synthetic Press",
        muscle: "Chest",
        equipment: "Machine",
        ...metadata(now),
      },
    },
  ]);
  return {
    store,
    service,
    alice: await service.authorize({ iss: "test", sub: "alice" }),
    bob: await service.authorize({ iss: "test", sub: "bob" }),
    setNow: (n: number) => {
      now = n;
    },
    close: () =>
      store.client.send(new DeleteTableCommand({ TableName: table })),
  };
}
export const mutate = (
  value: unknown,
  expectedRevision = 0,
  operationId = randomUUID(),
) => ({ value, expectedRevision, operationId });
export function syntheticSession(id = randomUUID()) {
  return {
    id,
    planId: null,
    dayId: null,
    dayName: "Synthetic Session",
    planName: "Synthetic Plan",
    workoutDate: "2040-06-10",
    startedAt: 2222956800000,
    resumedAt: 2222956800000,
    elapsedBeforePause: 0,
    exercises: [
      {
        id: "builtin-press",
        name: "Synthetic Press",
        muscle: "Chest",
        equipment: "Machine",
        plannedSets: 2,
        position: 0,
        repMin: 8,
        repMax: 12,
        perSide: false,
        supersetGroup: null,
        supersetPosition: null,
        restSeconds: 120,
        sets: [
          { setNumber: 1, reps: 10, weight: 37 },
          { setNumber: 2, reps: "", weight: "" },
        ],
      },
    ],
  };
}
