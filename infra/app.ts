import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { DataStack, AppStack, RecoveryStack } from "./stacks";
import { DeliveryStack } from "./delivery";
const app = new App({ outdir: "cdk.out" });
const preprod =
    app.node.tryGetContext("preprodAccount") ??
    process.env.PREPROD_ACCOUNT ??
    "111111111111",
  prod =
    app.node.tryGetContext("prodAccount") ??
    process.env.PROD_ACCOUNT ??
    "222222222222";
if (preprod === prod) throw new Error("Separate accounts required");
const email =
  app.node.tryGetContext("alertEmail") ??
  process.env.ALERT_EMAIL ??
  "replace-before-deploy@example.invalid";
new RecoveryStack(app, "LiftlineRecovery", {
  env: { account: preprod, region: "us-east-2" },
  sourceAccount: prod,
});
for (const [stage, account] of [
  ["preprod", preprod],
  ["prod", prod],
] as const) {
  const env = { account, region: "us-east-2" };
  new DeliveryStack(app, `LiftlineDelivery-${stage}`, {
    env,
    stage,
    repository: "tylerdoll/liftline",
  });
  const data = new DataStack(app, `LiftlineData-${stage}`, {
    env,
    stage,
    email,
    recoveryAccount: preprod,
  });
  new AppStack(app, `LiftlineApp-${stage}`, {
    env,
    synthesizer: new DefaultStackSynthesizer({
      deployRoleArn: "",
      cloudFormationExecutionRole: `arn:aws:iam::${account}:role/liftline-${stage}-app-execution`,
    }),
    stage,
    email,
    table: data.table,
    archive: data.archive,
  });
}
app.synth();
