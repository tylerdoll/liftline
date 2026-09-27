import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { validateReleaseConfig } from "../scripts/release-config";

test("release configuration rejects missing, placeholder, or shared projects", () => {
  const valid = {
    BETA_ACCOUNT: "123456789012",
    PROD_ACCOUNT: "123456789013",
    BETA_ALERT_EMAIL: "beta@example.invalid",
    PROD_ALERT_EMAIL: "prod@example.invalid",
  };
  assert.doesNotThrow(() => validateReleaseConfig(valid));
  assert.throws(() => validateReleaseConfig({ ...valid, BETA_ACCOUNT: "" }));
  assert.throws(() =>
    validateReleaseConfig({ ...valid, PROD_ACCOUNT: valid.BETA_ACCOUNT }),
  );
  assert.throws(() =>
    validateReleaseConfig({ ...valid, PROD_ACCOUNT: "222222222222" }),
  );
});

test("candidate encryption round-trips exact bytes and rejects tampering before extraction", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "liftline-candidate-"));
  const script = resolve("scripts/candidate-archive.ts");
  const loader = pathToFileURL(
    resolve("node_modules/tsx/dist/loader.mjs"),
  ).href;
  const run = (mode: string) =>
    execFileSync(process.execPath, ["--import", loader, script, mode], {
      cwd,
      env: { ...process.env, CANDIDATE_KEY: "ab".repeat(32) },
      stdio: "pipe",
    });
  try {
    for (const dir of ["dist", "cdk.out", "release"])
      await mkdir(join(cwd, dir));
    await writeFile(join(cwd, "dist/app.js"), "synthetic application");
    await writeFile(
      join(cwd, "cdk.out/template.json"),
      '{"private":"synthetic-only"}',
    );
    await writeFile(join(cwd, "release/manifest.json"), "{}");
    run("pack");
    const archive = await readFile(join(cwd, "candidate.enc"));
    assert.ok(!archive.includes(Buffer.from("synthetic-only")));
    await rm(join(cwd, "dist/app.js"));
    run("unpack");
    assert.equal(
      await readFile(join(cwd, "dist/app.js"), "utf8"),
      "synthetic application",
    );
    archive[archive.length - 1] ^= 1;
    await writeFile(join(cwd, "candidate.enc"), archive);
    await writeFile(join(cwd, "dist/app.js"), "untouched sentinel");
    assert.throws(() => run("unpack"));
    assert.equal(
      await readFile(join(cwd, "dist/app.js"), "utf8"),
      "untouched sentinel",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
