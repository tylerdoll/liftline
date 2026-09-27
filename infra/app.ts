import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DataStack, AppStack, RecoveryStack } from "./stacks";
import { DeliveryStack } from "./delivery";
const app = new App({ outdir: "cdk.out" });
const beta =
    app.node.tryGetContext("betaAccount") ??
    process.env.BETA_ACCOUNT ??
    "111111111111",
  prod =
    app.node.tryGetContext("prodAccount") ??
    process.env.PROD_ACCOUNT ??
    "222222222222";
if (beta === prod) throw new Error("Separate accounts required");
const email =
  app.node.tryGetContext("alertEmail") ??
  process.env.ALERT_EMAIL ??
  "replace-before-deploy@example.invalid";
new RecoveryStack(app, "LiftlineRecovery", {
  env: { account: beta, region: "us-east-2" },
  sourceAccount: prod,
  terminationProtection: true,
});
for (const [stage, account] of [
  ["beta", beta],
  ["prod", prod],
] as const) {
  const env = { account, region: "us-east-2" };
  new DeliveryStack(app, `LiftlineDelivery-${stage}`, {
    env,
    stage,
    repository: "tylerdoll/liftline",
    runner: {
      connectionArn:
        process.env[`${stage.toUpperCase()}_CONNECTION_ARN`] ??
        `arn:aws:codeconnections:us-east-2:${account}:connection/00000000-0000-0000-0000-000000000000`,
      trustedActorIds: (process.env.GITHUB_TRUSTED_ACTOR_IDS ?? "0").split(","),
    },
  });
  const data = new DataStack(app, `LiftlineData-${stage}`, {
    env,
    stage,
    email: process.env[`${stage.toUpperCase()}_ALERT_EMAIL`] ?? email,
    recoveryAccount: beta,
    recoveryReady: process.env.RECOVERY_READY !== "false",
    terminationProtection: true,
  });
  new AppStack(app, `LiftlineApp-${stage}`, {
    env,
    synthesizer: new DefaultStackSynthesizer({
      deployRoleArn: "",
      cloudFormationExecutionRole: `arn:aws:iam::${account}:role/liftline-${stage}-app-execution`,
    }),
    stage,
    email: process.env[`${stage.toUpperCase()}_ALERT_EMAIL`] ?? email,
    table: data.table,
    archive: data.archive,
  });
}
app.synth();
