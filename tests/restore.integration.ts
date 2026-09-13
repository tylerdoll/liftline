import { test } from "node:test";
import assert from "node:assert/strict";
import { awsFixture, syntheticSession, mutate } from "./support/aws";
import { restoreDrill } from "../scripts/restore";
import { DynamoStore } from "../api/dynamo";
test("local backup restores canonical records into a new table and rebuilds derived counts", async () => {
  const f = await awsFixture();
  try {
    const s = syntheticSession();
    await f.service.saveSession(f.alice, s.id, mutate(s));
    await f.service.saveSession(f.alice, s.id, mutate(null, 1), "complete");
    const report = await restoreDrill(
      f.store,
      {
        get: async () => {
          throw new Error("No legacy data expected");
        },
        put: async () => {},
      },
      `restore-${crypto.randomUUID()}`,
      ["alice", "bob"],
    );
    assert.equal(report.owners[0].rebuilt, 1);
    assert.equal(report.owners[1].rebuilt, 0);
    assert.ok(report.elapsedMs > 0);
    const restored = new DynamoStore(report.target, "http://127.0.0.1:5000");
    assert.equal(
      (await restored.query("USER#alice", "WEEK#")).items[0].workouts,
      1,
    );
  } finally {
    await f.close();
  }
});
