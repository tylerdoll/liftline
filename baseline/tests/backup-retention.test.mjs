import assert from "node:assert/strict";
import test from "node:test";

import {
  backupObjectKey,
  expiredBackupKeys,
} from "../worker/backup-retention.ts";

test("multiple backups on the same day use different object keys", () => {
  const morning = backupObjectKey("2026-08-18T09:00:00.000Z");
  const evening = backupObjectKey("2026-08-18T21:00:00.000Z");

  assert.notEqual(morning, evening);
});

test("twice-daily backups retain every run from the last 30 days", () => {
  const referenceTime = Date.parse("2026-08-31T12:00:00.000Z");
  const halfDay = 12 * 60 * 60 * 1000;
  const backups = Array.from({ length: 61 }, (_, index) => {
    const createdAt = new Date(referenceTime - index * halfDay).toISOString();
    return {
      key: backupObjectKey(createdAt),
      uploaded: new Date(createdAt),
      customMetadata: { createdAt },
    };
  });

  const expired = new Set(expiredBackupKeys(backups, referenceTime));
  const retained = backups.filter((backup) => !expired.has(backup.key));

  assert.equal(expired.size, 1);
  assert.equal(retained.length, 60);
});
