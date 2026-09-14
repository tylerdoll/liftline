import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { RecoveryDB, Outbox } from "../frontend/outbox";
test("new local edits persist while a previous network write is in flight", async () => {
  const db = new RecoveryDB(crypto.randomUUID());
  let release!: (v: { revision: number }) => void, started!: () => void;
  const began = new Promise<void>((r) => (started = r)),
    calls: any[] = [];
  const outbox = new Outbox(
    db,
    () => "alice",
    async (_id, body) => {
      calls.push(body);
      if (calls.length === 1) {
        started();
        return new Promise((r) => (release = r));
      }
      return { revision: 2 };
    },
  );
  await outbox.enqueue("alice", { id: "s", reps: 10 });
  const flushing = outbox.flush("alice/s");
  await began;
  await outbox.enqueue("alice", { id: "s", reps: 11 });
  assert.equal((await db.get("alice/s"))?.latest.reps, 11);
  release({ revision: 1 });
  await flushing;
  assert.equal(calls.length, 2);
  assert.equal(calls[1].expectedRevision, 1);
  assert.equal(calls[1].value.reps, 11);
  assert.equal((await db.forUser("alice")).length, 0);
});
test("offline reload retains exact pending operation; another user never uploads it", async () => {
  const db = new RecoveryDB(crypto.randomUUID());
  let user: string | undefined = "alice";
  const calls: any[] = [];
  let offline = true;
  const send = async (_id: string, p: any) => {
    calls.push(p);
    if (offline) throw Object.assign(new Error("offline"), { status: 401 });
    return { revision: 1 };
  };
  const a = new Outbox(db, () => user, send);
  await a.enqueue("alice", { id: "s", sets: [{ reps: 11, weight: 37 }] });
  await assert.rejects(() => a.flush("alice/s"));
  assert.equal((await db.forUser("bob")).length, 0);
  user = "bob";
  const reloaded = new Outbox(db, () => user, send);
  await assert.rejects(() => reloaded.flush("alice/s"));
  assert.equal(calls.length, 1);
  user = "alice";
  offline = false;
  await reloaded.flush("alice/s");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal((await db.forUser("alice")).length, 0);
});
test("a conflict keeps edits and receipt for explicit recovery", async () => {
  const db = new RecoveryDB(crypto.randomUUID());
  const outbox = new Outbox(
    db,
    () => "alice",
    async () => {
      throw Object.assign(new Error("conflict"), { status: 409 });
    },
  );
  await outbox.enqueue("alice", { id: "s", reps: 10 }, 3);
  await assert.rejects(() => outbox.flush("alice/s"));
  assert.equal((await db.get("alice/s"))?.latest.reps, 10);
  assert.equal((await db.get("alice/s"))?.pending?.expectedRevision, 3);
});
