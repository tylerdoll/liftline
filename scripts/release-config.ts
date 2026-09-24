import assert from "node:assert/strict";
export function validateReleaseConfig(env: NodeJS.ProcessEnv) {
  for (const stage of ["BETA", "PROD"]) {
    const project = env[`${stage}_ACCOUNT`] ?? "";
    assert.match(
      project,
      /^\d{12}$/,
      `${stage} project configuration required`,
    );
    assert.ok(
      !/^(\d)\1{11}$/.test(project),
      `${stage} project is a placeholder`,
    );
    assert.match(
      env[`${stage}_ALERT_EMAIL`] ?? "",
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      `${stage} alert email required`,
    );
  }
  assert.notEqual(
    env.BETA_ACCOUNT,
    env.PROD_ACCOUNT,
    "Beta and production must be separate projects",
  );
}
