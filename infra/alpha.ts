import { App, DefaultStackSynthesizer } from "aws-cdk-lib";
import { AppStack, DataStack } from "./stacks";
import { DeliveryStack } from "./delivery";

// A separate assembly prevents an alpha command from selecting beta/prod stacks.
const app = new App({ outdir: "cdk.out/alpha" });
const account = process.env.ALPHA_ACCOUNT ?? "333333333333";
if (!/^\d{12}$/.test(account)) throw new Error("Invalid alpha project ID");
const env = { account, region: "us-east-2" };
const email =
  process.env.ALERT_EMAIL ?? "replace-before-deploy@example.invalid";
const delivery = new DeliveryStack(app, "LiftlineDelivery-alpha", {
  env,
  stage: "alpha",
  repository: "tylerdoll/liftline",
  githubEnabled: false,
});
const data = new DataStack(app, "LiftlineData-alpha", {
  env,
  stage: "alpha",
  email,
  recoveryAccount: account,
  terminationProtection: true,
});
const application = new AppStack(app, "LiftlineApp-alpha", {
  env,
  stage: "alpha",
  email,
  table: data.table,
  archive: data.archive,
  synthesizer: new DefaultStackSynthesizer({
    deployRoleArn: "",
    cloudFormationExecutionRole: `arn:aws:iam::${account}:role/liftline-alpha-app-execution`,
  }),
});
application.addDependency(delivery);
app.synth();
