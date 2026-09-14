import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomUUID } from "node:crypto";
import { DynamoStore } from "../api/dynamo";
import { absent } from "../domain/store";
import { metadata, hash } from "../domain/service";
const [pool, table, email, providedId] = process.argv.slice(2);
if (!pool || !table || !email)
  throw new Error(
    "Usage: invite <pool-id> <table> <email> [stable-internal-id]",
  );
const store = new DynamoStore(table),
  client = new CognitoIdentityProviderClient({ region: "us-east-2" });
const reservationKey = `INVITE#${hash(`${pool}/${email.trim().toLowerCase()}`)}`;
const reservation = await store.get("SYSTEM", reservationKey);
if (reservation && providedId && reservation.userId !== providedId)
  throw new Error("Invitation already reserves another internal ID");
const userId = reservation?.userId ?? providedId ?? randomUUID();
const quota = await store.get("SYSTEM", "INVITES");
const members: string[] = quota?.members ?? [];
if (!members.includes(userId)) {
  if (members.length >= 6)
    throw new Error("Owner plus five friends limit reached");
  await store.transact([
    ...(!reservation
      ? [
          {
            put: { PK: "SYSTEM", SK: reservationKey, userId },
            condition: absent,
          },
        ]
      : []),
    {
      put: {
        PK: "SYSTEM",
        SK: "INVITES",
        members: [...members, userId],
        revision: (quota?.revision ?? 0) + 1,
      },
      condition: quota
        ? {
            expression: "#r = :r",
            names: { "#r": "revision" },
            values: { ":r": quota.revision },
          }
        : absent,
    },
  ]);
}
if (!reservation && members.includes(userId))
  await store.transact([
    { put: { PK: "SYSTEM", SK: reservationKey, userId }, condition: absent },
  ]);
let user;
try {
  user = await client.send(
    new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
  );
} catch (e: any) {
  if (e.name !== "UserNotFoundException") throw e;
  await client.send(
    new AdminCreateUserCommand({
      UserPoolId: pool,
      Username: email,
      UserAttributes: [
        { Name: "email", Value: email },
        { Name: "email_verified", Value: "true" },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    }),
  );
  user = await client.send(
    new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
  );
}
const subject = user.UserAttributes?.find((a) => a.Name === "sub")?.Value;
if (!subject) throw new Error("Cognito identity missing");
const PK = `IDENTITY#https://cognito-idp.us-east-2.amazonaws.com/${pool}#${subject}`;
const existing = await store.get(PK, "PROFILE");
if (existing && existing.userId !== userId)
  throw new Error("Identity is already bound to a different internal user");
const writes: any[] = [];
if (!existing)
  writes.push({
    put: { PK, SK: "PROFILE", userId, ...metadata(Date.now()) },
    condition: absent,
  });
if (!(await store.get(`USER#${userId}`, "PROFILE")))
  writes.push({
    put: {
      PK: `USER#${userId}`,
      SK: "PROFILE",
      id: userId,
      enabled: true,
      timezone: null,
      activePlanId: null,
      ...metadata(Date.now()),
    },
    condition: absent,
  });
if (writes.length) await store.transact(writes);
console.log(`Invitation ready; internal user ID: ${userId}`);
