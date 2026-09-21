import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoStore } from "../api/dynamo";
import { absent } from "../domain/store";
import { hash, metadata } from "../domain/service";

// Invoked only by the owner setup entry point, after its profile and STS checks.
const stage = process.env.LIFTLINE_OWNER_SETUP;
if (
  !["beta", "prod"].includes(stage ?? "") ||
  process.env.CI ||
  process.env.GITHUB_ACTIONS
)
  throw new Error("Use the owner-stage-setup smoke phase personally");
const outputs = JSON.parse(
  await readFile(`private/owner-app-${stage}-outputs.json`, "utf8"),
);
const pool = outputs[`LiftlineApp-${stage}`]?.UserPool;
if (!/^us-east-2_[a-zA-Z0-9]+$/.test(pool ?? ""))
  throw new Error("Owner app outputs required");
const client = new CognitoIdentityProviderClient({ region: "us-east-2" });
const store = new DynamoStore(`liftline-${stage}`);
const secrets: Record<string, string> = {};
for (const slot of stage === "beta" ? ["primary", "secondary"] : ["primary"]) {
  // Reserved non-deliverable addresses: no email is sent, no real user is reset.
  const email = `liftline-ci-${stage}-${slot}@example.invalid`;
  const userId = `smoke-${hash(`${pool}/${email}`).slice(0, 32)}`;
  const profile = await store.get(`USER#${userId}`, "PROFILE");
  if (profile && profile.syntheticSmoke !== true)
    throw new Error("Existing non-test profile; refusing changes");
  let user;
  try {
    user = await client.send(
      new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
    );
  } catch (e) {
    if (!(e instanceof Error) || e.name !== "UserNotFoundException") throw e;
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: pool,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
    user = await client.send(
      new AdminGetUserCommand({ UserPoolId: pool, Username: email }),
    );
  }
  const subject = user.UserAttributes?.find((a) => a.Name === "sub")?.Value;
  if (!subject) throw new Error("Synthetic subject missing");
  const PK = `IDENTITY#https://cognito-idp.us-east-2.amazonaws.com/${pool}#${subject}`;
  const binding = await store.get(PK, "PROFILE");
  if (binding && binding.userId !== userId)
    throw new Error("Synthetic identity bound elsewhere; refusing changes");
  const writes = [];
  if (!binding)
    writes.push({
      put: { PK, SK: "PROFILE", userId, ...metadata(Date.now()) },
      condition: absent,
    });
  if (!profile)
    writes.push({
      put: {
        PK: `USER#${userId}`,
        SK: "PROFILE",
        id: userId,
        enabled: true,
        syntheticSmoke: true,
        timezone: "America/Denver",
        activePlanId: null,
        ...metadata(Date.now()),
      },
      condition: absent,
    });
  if (writes.length) await store.transact(writes);
  const password = `Aa1!${randomBytes(32).toString("base64url")}`;
  const prefix = slot === "primary" ? "" : "SECOND_";
  secrets[`${prefix}SMOKE_EMAIL`] = email;
  secrets[`${prefix}SMOKE_PASSWORD`] = password;
  // Save before changing a password so interrupted setup remains recoverable.
  await writeFile(
    `private/${stage}-smoke-secrets.json`,
    JSON.stringify(secrets, null, 2),
    { mode: 0o600 },
  );
  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );
}
console.log(
  `Synthetic users ready. Upload private/${stage}-smoke-secrets.json values as ${stage} environment secrets; never share the file publicly. No email sent.`,
);
