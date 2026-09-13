import { test } from "node:test";
import assert from "node:assert/strict";
import { CreateBucketCommand } from "@aws-sdk/client-s3";
import { awsFixture } from "./support/aws";
import { S3Archive } from "../api/archive";
import {
  importLegacy,
  rebuildDerived,
  tables,
  type LegacyExport,
} from "../domain/migration";
import { makeHandler } from "../api/handler";
test("lossless legacy import, oversized read path, two reruns, and derived rebuild", async () => {
  const f = await awsFixture();
  try {
    const archive = new S3Archive(
      `test-${crypto.randomUUID()}`,
      "http://127.0.0.1:5000",
    );
    await archive.client.send(
      new CreateBucketCommand({
        Bucket: archive.bucket,
        CreateBucketConfiguration: { LocationConstraint: "us-west-2" },
      }),
    );
    const rows: Record<string, any[]> = {
      exercises: [
        { id: 7, name: "Synthetic Legacy", muscle: "Back", equipment: "Cable" },
      ],
      plans: [
        {
          id: 3,
          name: "Synthetic Old Plan",
          is_active: 1,
          created_at: "2020-01-01",
        },
      ],
      plan_days: [
        { id: 4, plan_id: 3, name: "Old Day", day_of_week: 1, position: 0 },
      ],
      plan_day_exercises: [
        {
          id: 8,
          day_id: 4,
          exercise_id: 7,
          planned_sets: 3,
          position: 0,
          rep_min: 8,
          rep_max: 12,
          per_side: 0,
          superset_group: null,
          superset_position: null,
          rest_seconds: 120,
        },
      ],
      workouts: [
        {
          id: 9,
          plan_id: 3,
          day_id: 4,
          workout_date: "2020-01-02",
          completed_at: "2020-01-02 17:00:00",
          source_draft_id: null,
        },
      ],
      workout_sets: Array.from({ length: 1600 }, (_, i) => ({
        id: i,
        workout_id: 9,
        exercise_id: 7,
        set_number: i + 1,
        reps: 11,
        weight: 37,
      })),
      workout_drafts: [
        {
          id: 1,
          workout_date: "2020-01-03",
          payload_json: "malformed original bytes",
          updated_at: "2020-01-03",
        },
      ],
    };
    const data: LegacyExport = {
      format: "liftline-d1-backup-v1",
      createdAt: "2040-06-10T16:00:00Z",
      schema: [{ name: "synthetic schema" }],
      tables: tables.map((name) => ({ name, rows: rows[name] })),
    };
    const first = await importLegacy(f.store, archive, "migrated", data);
    assert.equal(first.quarantined, 1);
    assert.equal(
      (await importLegacy(f.store, archive, "migrated", data)).written,
      0,
    );
    assert.equal(
      (await importLegacy(f.store, archive, "migrated", data)).written,
      0,
    );
    assert.equal(await rebuildDerived(f.store, archive, "migrated"), 1);
    assert.equal(await rebuildDerived(f.store, archive, "migrated"), 0);
    const saved = (await f.store.query("USER#migrated", "SESSION#")).items[0];
    assert.equal(saved.legacyOversized, true);
    const recovered = JSON.parse(await archive.get(saved.legacyRef));
    assert.equal(recovered.exercises[0].sets.length, 1600);
    assert.equal(recovered.legacy.id, 9);
    assert.deepEqual(
      JSON.parse(
        await archive.get(
          `private/migrated/${first.manifest.checksum}/source.json`,
        ),
      ),
      data,
    );
    const profile = await f.store.get("USER#migrated", "PROFILE");
    await f.store.transact([
      { put: { ...profile!, migrationMode: false } },
      {
        put: {
          PK: "IDENTITY#test#migrated",
          SK: "PROFILE",
          userId: "migrated",
        },
      },
    ]);
    const handler = makeHandler(f.service, archive);
    let reconstructed = "";
    let part = 0,
      parts = 1;
    while (part < parts) {
      const r = await handler({
        rawPath: `/api/v1/sessions/${saved.id}/legacy`,
        queryStringParameters: { part: String(part) },
        requestContext: {
          http: { method: "GET" },
          authorizer: { jwt: { claims: { iss: "test", sub: "migrated" } } },
        },
      });
      assert.equal(r.statusCode, 200);
      const body = JSON.parse(r.body);
      parts = body.parts;
      reconstructed += Buffer.from(body.content, "base64").toString();
      part++;
    }
    assert.deepEqual(JSON.parse(reconstructed), recovered);
  } finally {
    await f.close();
  }
});
