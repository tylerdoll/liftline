import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("alpha assembly is confined to one Ohio project with no GitHub or cross-project trust", () => {
  const manifest = JSON.parse(
    readFileSync("cdk.out/alpha/manifest.json", "utf8"),
  );
  const stacks: any[] = Object.values(manifest.artifacts).filter(
    (a: any) => a.type === "aws:cloudformation:stack",
  );
  assert.equal(stacks.length, 3);
  for (const stack of stacks) {
    assert.match(stack.environment, /^aws:\/\/\d{12}\/us-east-2$/);
    assert.match(stack.displayName, /-alpha$/);
    const template = readFileSync(
      `cdk.out/alpha/${stack.properties.templateFile}`,
      "utf8",
    );
    assert.doesNotMatch(
      template,
      /liftline-(prod|preprod)|AWS::IAM::OIDCProvider|sts:AssumeRoleWithWebIdentity|ReplicationConfiguration/,
    );
  }
  const data = JSON.parse(
    readFileSync("cdk.out/alpha/LiftlineData-alpha.template.json", "utf8"),
  );
  const table: any = Object.values(data.Resources).find(
    (r: any) => r.Type === "AWS::DynamoDB::Table",
  );
  assert.equal(table.Properties.DeletionProtectionEnabled, true);
  assert.equal(
    table.Properties.PointInTimeRecoverySpecification.RecoveryPeriodInDays,
    35,
  );
  assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST");
  assert.equal(
    stacks.find((s) => s.displayName === "LiftlineData-alpha").properties
      .terminationProtection,
    true,
  );
});
