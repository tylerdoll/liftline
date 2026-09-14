import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const template = (name: string) =>
  JSON.parse(readFileSync(`cdk.out/${name}.template.json`, "utf8"));
test("synthesized data contract: on-demand, deletion protection, PITR35, sparse expiry GSI", () => {
  for (const stage of ["prod", "preprod"]) {
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
