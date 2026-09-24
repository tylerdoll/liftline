import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { DataStack } from "../infra/stacks";
import { DeliveryStack } from "../infra/delivery";
const template = (name: string) =>
  JSON.parse(readFileSync(`cdk.out/${name}.template.json`, "utf8"));

test("runner configuration rejects wildcard actors and foreign project connections", () => {
  const props = {
    env: { account: "111111111111", region: "us-east-2" },
    stage: "beta",
    repository: "tylerdoll/liftline",
    runner: {
      connectionArn:
        "arn:aws:codeconnections:us-east-2:111111111111:connection/00000000-0000-0000-0000-000000000000",
      trustedActorIds: ["123"],
    },
  };
  assert.throws(
    () =>
      new DeliveryStack(new App(), "Wildcard", {
        ...props,
        runner: { ...props.runner, trustedActorIds: [".*"] },
      }),
    /numeric trusted/,
  );
  assert.throws(
    () =>
      new DeliveryStack(new App(), "ForeignConnection", {
        ...props,
        runner: {
          ...props.runner,
          connectionArn: props.runner.connectionArn.replace(
            "111111111111",
            "222222222222",
          ),
        },
      }),
    /this project/,
  );
});

test("owner foundation creates recovery writer roles before enabling destination-dependent replication", () => {
  const app = new App();
  const stack = new DataStack(app, "FoundationContract", {
    env: { account: "222222222222", region: "us-east-2" },
    stage: "prod",
    email: "synthetic@example.invalid",
    recoveryAccount: "111111111111",
    recoveryReady: false,
  });
  const resources: any[] = Object.values(
    Template.fromStack(stack).toJSON().Resources,
  );
  for (const role of [
    "liftline-prod-backup",
    "liftline-prod-archive-replication",
  ])
    assert.ok(
      resources.some(
        (r) => r.Type === "AWS::IAM::Role" && r.Properties.RoleName === role,
      ),
    );
  assert.ok(
    !resources.some(
      (r) =>
        r.Type === "AWS::S3::Bucket" && r.Properties.ReplicationConfiguration,
    ),
  );
  const backup = resources.find((r) => r.Type === "AWS::Lambda::Function");
  assert.equal(
    backup.Properties.Environment.Variables.RECOVERY_ACCOUNT,
    "222222222222",
  );
});
test("synthesized data contract: on-demand, deletion protection, PITR35, sparse expiry GSI", () => {
  for (const stage of ["prod", "beta"]) {
    const t = template(`LiftlineData-${stage}`);
    const table: any = Object.values(t.Resources).find(
      (r: any) => r.Type === "AWS::DynamoDB::Table",
    );
    assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST");
    assert.equal(table.Properties.DeletionProtectionEnabled, true);
    assert.equal(
      table.Properties.PointInTimeRecoverySpecification.RecoveryPeriodInDays,
      35,
    );
    assert.equal(table.DeletionPolicy, "Retain");
    assert.equal(
      table.Properties.GlobalSecondaryIndexes[0].Projection.ProjectionType,
      "KEYS_ONLY",
    );
  }
});
test("synthesized application exposes scoped JWT API, private assets, and invite-only users", () => {
  const t = template("LiftlineApp-prod");
  const resources: any[] = Object.values(t.Resources);
  const pool = resources.find((r) => r.Type === "AWS::Cognito::UserPool");
  assert.equal(
    pool.Properties.AdminCreateUserConfig.AllowAdminCreateUserOnly,
    true,
  );
  const routes = resources.filter((r) => r.Type === "AWS::ApiGatewayV2::Route");
  assert.ok(routes.length);
  for (const r of routes) {
    assert.equal(r.Properties.AuthorizationType, "JWT");
    assert.deepEqual(r.Properties.AuthorizationScopes, ["openid"]);
  }
  assert.equal(
    resources.some((r) =>
      [
        "AWS::EC2::VPC",
        "AWS::EC2::NatGateway",
        "AWS::RDS::DBInstance",
        "AWS::ElasticLoadBalancingV2::LoadBalancer",
      ].includes(r.Type),
    ),
    false,
  );
  const distribution = resources.find(
    (r) => r.Type === "AWS::CloudFront::Distribution",
  );
  const api = distribution.Properties.DistributionConfig.CacheBehaviors.find(
    (b: any) => b.PathPattern === "api/*",
  );
  assert.equal(api.CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  const policies = resources.filter((r) => r.Type === "AWS::IAM::Policy");
  for (const p of policies)
    assert.ok(!JSON.stringify(p).includes("dynamodb:Scan"));
});

test("release runners use scoped CodeBuild trust and cannot deploy data stacks", () => {
  for (const stage of ["beta", "prod"]) {
    const t = template(`LiftlineDelivery-${stage}`);
    const resources: any[] = Object.values(t.Resources);
    const role = resources.find(
      (r) =>
        r.Type === "AWS::IAM::Role" &&
        r.Properties.RoleName === `liftline-${stage}-github`,
    );
    const trust = role.Properties.AssumeRolePolicyDocument.Statement[0];
    assert.equal(trust.Action, "sts:AssumeRole");
    assert.equal(trust.Principal.Service, "codebuild.amazonaws.com");
    assert.ok(trust.Condition.StringEquals["aws:SourceAccount"]);
    assert.match(
      trust.Condition.ArnEquals["aws:SourceArn"],
      new RegExp(`:project/liftline-${stage}-release$`),
    );
    assert.ok(
      !JSON.stringify(resources).includes(
        "token.actions.githubusercontent.com",
      ),
    );
    const runner = resources.find(
      (r) => r.Type === "AWS::CodeBuild::Project",
    ).Properties;
    assert.equal(runner.Visibility, "PRIVATE");
    assert.equal(runner.ConcurrentBuildLimit, 1);
    assert.equal(runner.Environment.PrivilegedMode, false);
    assert.equal(runner.Source.Auth.Type, "CODECONNECTIONS");
    assert.deepEqual(runner.Triggers.FilterGroups, [
      [
        { Type: "EVENT", Pattern: "WORKFLOW_JOB_QUEUED" },
        { Type: "WORKFLOW_NAME", Pattern: "^Exact artifact release$" },
        {
          Type: "ACTOR_ACCOUNT_ID",
          Pattern: `^(${(process.env.GITHUB_TRUSTED_ACTOR_IDS ?? "0").split(",").join("|")})$`,
        },
      ],
    ]);
    const policies = resources.filter(
      (r) =>
        r.Type === "AWS::IAM::Policy" &&
        JSON.stringify(r.Properties.Roles).includes("Deployment"),
    );
    const statements = policies.flatMap(
      (r) => r.Properties.PolicyDocument.Statement,
    );
    for (const s of statements) {
      const actions = [s.Action].flat();
      if (actions.includes("cloudformation:ExecuteChangeSet")) {
        assert.match(
          JSON.stringify(s.Resource),
          new RegExp(`stack/LiftlineApp-${stage}/`),
        );
        assert.ok(!JSON.stringify(s.Resource).includes("LiftlineData"));
      }
      if (actions.includes("iam:PassRole"))
        assert.equal(
          s.Condition.StringEquals["iam:PassedToService"],
          "cloudformation.amazonaws.com",
        );
    }
  }
});
