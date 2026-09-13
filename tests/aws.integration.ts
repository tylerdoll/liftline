import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { awsFixture, mutate, syntheticSession } from "./support/aws";
import { makeHandler } from "../api/handler";
import { Failure } from "../domain/store";
test("AWS HTTP boundary returns 401, 403 and private-resource 404", async () => {
  const f = await awsFixture();
  try {
    const h = makeHandler(f.service);
    assert.equal(
      (
        await h({
          rawPath: "/api/v1/me",
          requestContext: { http: { method: "GET" } },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await h({
          rawPath: "/api/v1/me",
          requestContext: {
            http: { method: "GET" },
            authorizer: { jwt: { claims: { iss: "test", sub: "unknown" } } },
          },
        })
      ).statusCode,
      403,
    );
    const s = syntheticSession();
    await f.service.saveSession(f.alice, s.id, mutate(s));
    await assert.rejects(
      () => f.service.own(f.bob, "SESSION", s.id),
      (e: any) => e.status === 404,
    );
  } finally {
    await f.close();
  }
});
test("real SDK transactions persist receipts, reject divergent replay and racing revisions", async () => {
  const f = await awsFixture();
  try {
    const s = syntheticSession(),
      m = mutate(s);
    const a = await f.service.saveSession(f.alice, s.id, m);
    f.setNow(Date.parse("2040-06-10T16:20:00Z"));
    assert.deepEqual(await f.service.saveSession(f.alice, s.id, m), a);
    await assert.rejects(
      () =>
        f.service.saveSession(f.alice, s.id, {
          ...m,
          value: { ...s, dayName: "different" },
        }),
      (e: any) => e.status === 409,
    );
    const results = await Promise.allSettled([
      f.service.saveSession(
        f.alice,
        s.id,
        mutate({ ...s, elapsedBeforePause: 1 }, 1),
      ),
      f.service.saveSession(
        f.alice,
        s.id,
        mutate({ ...s, elapsedBeforePause: 2 }, 1),
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      results.filter((r) => r.status === "rejected" && r.reason.status === 409)
        .length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("interrupted staged copy stays invisible until retry and expiry forbids redemption", async () => {
  const f = await awsFixture();
  try {
    const e = {
      id: randomUUID(),
      name: "Synthetic staged custom",
      muscle: "Back",
      equipment: "Cable",
    };
    await f.service.save(f.alice, "EXERCISE", e.id, mutate(e));
    const s = syntheticSession();
    s.exercises[0] = { ...s.exercises[0], ...e };
    await f.service.saveSession(f.alice, s.id, mutate(s));
    const token = randomBytes(32).toString("base64url");
    await f.service.createShare(
      f.alice,
      mutate({ id: randomUUID(), kind: "SESSION", sourceId: s.id, token }),
    );
    const transact = f.store.transact.bind(f.store);
    let interrupt = true;
    f.store.transact = async (writes) => {
      if (
        interrupt &&
        writes.some((w) => "put" in w && w.put.SK.startsWith("COPY#"))
      ) {
        interrupt = false;
        throw new Failure(503, "Synthetic interruption");
      }
      return transact(writes);
    };
    await assert.rejects(() => f.service.redeem(f.bob, token));
    assert.equal((await f.service.list(f.bob, "PLAN")).items.length, 0);
    assert.equal((await f.service.list(f.bob, "EXERCISE")).items.length, 0);
    const copy = await f.service.redeem(f.bob, token);
    assert.equal((await f.service.list(f.bob, "PLAN")).items.length, 1);
    await f.service.save(
      f.alice,
      "EXERCISE",
      e.id,
      mutate({ ...e, name: "Changed source" }, 1),
    );
    const copiedPlan = await f.service.own(f.bob, "PLAN", copy.planId);
    const copiedExercise = await f.service.exercise(
      f.bob,
      copiedPlan.days[0].exercises[0].exerciseId,
    );
    assert.equal(copiedExercise.name, e.name);
    f.setNow(Date.parse("2040-06-17T16:00:00Z"));
    await assert.rejects(
      () => f.service.redeem(f.bob, token),
      (e: any) => e.status === 404,
    );
  } finally {
    await f.close();
  }
});
test("disabled identity, forged owner fields, and foreign cursors fail closed", async () => {
  const f = await awsFixture();
  try {
    const h = makeHandler(f.service),
      event = {
        rawPath: "/api/v1/me",
        requestContext: {
          http: { method: "GET" },
          authorizer: { jwt: { claims: { iss: "test", sub: "alice" } } },
        },
      };
    const p = await f.store.get("USER#alice", "PROFILE");
    await f.store.transact([{ put: { ...p!, enabled: false } }]);
    assert.equal((await h(event)).statusCode, 403);
    await assert.rejects(
      () =>
        f.service.list(
          f.bob,
          "SESSION",
          Buffer.from(
            JSON.stringify({ PK: "USER#alice", SK: "SESSION#private" }),
          ).toString("base64url"),
        ),
      (e: any) => e.status === 400,
    );
    const s = syntheticSession();
    await assert.rejects(() =>
      f.service.saveSession(f.bob, s.id, mutate({ ...s, ownerId: "alice" })),
    );
  } finally {
    await f.close();
  }
});
test("duplicate completion credits one canonical session, history, exercise progress and week", async () => {
  const f = await awsFixture();
  try {
    const s = syntheticSession();
    await f.service.saveSession(f.alice, s.id, mutate(s));
    const m = mutate(null, 1);
    await f.service.saveSession(f.alice, s.id, m, "complete");
    await f.service.saveSession(f.alice, s.id, m, "complete");
    await assert.rejects(
      () => f.service.saveSession(f.alice, s.id, mutate(null, 1), "complete"),
      Failure,
    );
    assert.equal((await f.service.list(f.alice, "HISTORY")).items.length, 1);
    assert.equal(
      (await f.service.list(f.alice, "PROGRESS#builtin-press")).items.length,
      1,
    );
    assert.equal((await f.service.list(f.alice, "WEEK")).items[0].workouts, 1);
  } finally {
    await f.close();
  }
});
test("oversized and forged custom references reject without writing", async () => {
  const f = await awsFixture();
  try {
    const s = syntheticSession();
    s.exercises[0].id = randomUUID();
    await assert.rejects(
      () => f.service.saveSession(f.alice, s.id, mutate(s)),
      (e: any) => e.status === 404,
    );
    s.exercises[0].id = "builtin-press";
    s.exercises[0].sets = Array.from({ length: 101 }, (_, i) => ({
      setNumber: i + 1,
      reps: 10,
      weight: 37,
    }));
    await assert.rejects(() => f.service.saveSession(f.alice, s.id, mutate(s)));
    assert.equal((await f.service.list(f.alice, "SESSION")).items.length, 0);
  } finally {
    await f.close();
  }
});
test("expiry rereads canonical state, keeps empty sessions and rejects late edits", async () => {
  const f = await awsFixture();
  try {
    const s = syntheticSession();
    s.exercises[0].sets = [{ setNumber: 1, reps: "", weight: "" }];
    await f.service.saveSession(f.alice, s.id, mutate(s));
    f.setNow(Date.parse("2040-06-11T06:01:00Z"));
    await assert.rejects(
      () => f.service.saveSession(f.alice, s.id, mutate(s, 1)),
      (e: any) => e.status === 409,
    );
    assert.equal((await f.service.expire()).completed, 1);
    assert.equal((await f.service.expire()).completed, 0);
    const done = await f.service.own(f.alice, "SESSION", s.id);
    assert.equal(done.empty, true);
    assert.equal(done.workoutDate, s.workoutDate);
    assert.deepEqual(done.exercises, s.exercises);
  } finally {
    await f.close();
  }
});
test("malformed expiry is quarantined losslessly", async () => {
  const f = await awsFixture();
  try {
    const raw = {
      PK: "USER#alice",
      SK: "SESSION#bad",
      id: "bad",
      status: "draft",
      revision: 1,
      expiresAt: 0,
      expiryPK: "DRAFT",
      expirySK: 0,
      raw: "unparseable source",
    };
    await f.store.transact([{ put: raw }]);
    assert.equal((await f.service.expire()).quarantined, 1);
    const saved = await f.store.get(raw.PK, raw.SK);
    assert.equal(saved?.status, "quarantined");
    assert.equal(saved?.raw, raw.raw);
  } finally {
    await f.close();
  }
});
test("copy remaps custom exercises, stays independent/idempotent and never credits performance", async () => {
  const f = await awsFixture();
  try {
    const e = {
      id: randomUUID(),
      name: "Private Synthetic",
      muscle: "Back",
      equipment: "Cable",
    };
    await f.service.save(f.alice, "EXERCISE", e.id, mutate(e));
    await assert.rejects(
      () => f.service.exercise(f.bob, e.id),
      (e: any) => e.status === 404,
    );
    const s = syntheticSession();
    s.exercises[0] = { ...s.exercises[0], ...e };
    await f.service.saveSession(f.alice, s.id, mutate(s));
    const token = randomBytes(32).toString("base64url"),
      shareId = randomUUID();
    await f.service.createShare(
      f.alice,
      mutate({ id: shareId, kind: "SESSION", sourceId: s.id, token }),
    );
    const copied = await f.service.redeem(f.bob, token);
    assert.deepEqual(await f.service.redeem(f.bob, token), copied);
    assert.equal((await f.service.list(f.bob, "HISTORY")).items.length, 0);
    assert.equal((await f.service.list(f.bob, "SESSION")).items.length, 0);
    const p = await f.service.own(f.bob, "PLAN", copied.planId);
    assert.notEqual(p.days[0].exercises[0].exerciseId, e.id);
    await f.service.revoke(f.alice, shareId, mutate(null, 1));
    await assert.rejects(
      () => f.service.redeem(f.bob, token),
      (e: any) => e.status === 404,
    );
    assert.equal((await f.service.list(f.bob, "PLAN")).items.length, 1);
  } finally {
    await f.close();
  }
});
