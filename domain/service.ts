import { createHash } from "node:crypto";
import { z } from "zod";
import {
  exercise,
  plan,
  session,
  mutation,
  id,
  type StoredSession,
  type Profile,
} from "../contracts";
import {
  absent,
  atRevision,
  Failure,
  type Store,
  type Item,
  type Write,
} from "./store";
import { localDate, midnight, validateTimezone, weekStart } from "./time";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const deterministicId = (s: string) => {
  const h = hash(s);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const metadata = (now: number, revision = 1) => ({
  schemaVersion: 1 as const,
  revision,
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
});
export function bounded(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 200 * 1024)
    throw new Failure(413, "Document exceeds 200 KiB");
}
const publicItem = (i: Item) => {
  const { PK: _p, SK: _s, expiryPK: _e, expirySK: _t, copyId: _c, ...v } = i;
  return v;
};
export type Principal = { id: string; profile: Profile; identityPK: string };
export function projections(PK: string, s: StoredSession): Write[] {
  const sets = s.exercises.flatMap((e) =>
    e.sets
      .filter((x) => x.reps !== "" && x.weight !== "")
      .map((x) => ({
        ...x,
        exerciseId: e.id,
        exerciseName: e.name,
        reps: Number(x.reps),
        weight: Number(x.weight),
      })),
  );
  const volume = sets.reduce((v, x) => v + x.reps * x.weight, 0);
  const writes: Write[] = [
    {
      put: {
        PK,
        SK: `HISTORY#${s.workoutDate}#${s.id}`,
        sessionId: s.id,
        date: s.workoutDate,
        volume,
        completedAt: s.completedAt,
        ...metadata(Date.parse(s.updatedAt)),
      },
      condition: absent,
    },
  ];
  for (const exerciseId of new Set(sets.map((s) => s.exerciseId))) {
    const grouped = sets.filter((s) => s.exerciseId === exerciseId);
    writes.push({
      put: {
        PK,
        SK: `PROGRESS#${exerciseId}#${s.workoutDate}#${s.id}`,
        sessionId: s.id,
        date: s.workoutDate,
        completedAt: s.completedAt,
        sets: grouped,
        weight: Math.max(...grouped.map((x) => x.weight)),
        volume: grouped.reduce((v, x) => v + x.reps * x.weight, 0),
        ...metadata(Date.parse(s.updatedAt)),
      },
      condition: absent,
    });
  }
  writes.push({
    update: { PK, SK: `WEEK#${weekStart(s.workoutDate)}` },
    expression: "SET schemaVersion = :schema ADD workouts :one, volume :v",
    values: { ":schema": 1, ":one": 1, ":v": volume },
  });
  return writes;
}
export class Service {
  constructor(
    readonly store: Store,
    readonly now = () => Date.now(),
  ) {}
  async authorize(claims: Record<string, any> | undefined): Promise<Principal> {
    if (!claims?.iss || !claims.sub) throw new Failure(401, "Sign in required");
    const identityPK = `IDENTITY#${claims.iss}#${claims.sub}`;
    const binding = await this.store.get(identityPK, "PROFILE");
    if (!binding) throw new Failure(403, "Invitation required");
    const profile = await this.store.get(`USER#${binding.userId}`, "PROFILE");
    if (!profile || profile.enabled !== true || profile.migrationMode)
      throw new Failure(403, "Account disabled or migration in progress");
    return {
      id: binding.userId,
      profile: publicItem(profile) as Profile,
      identityPK,
    };
  }
  guard(p: Principal): Write[] {
    return [
      {
        check: { PK: `USER#${p.id}`, SK: "PROFILE" },
        condition: {
          expression:
            "enabled = :yes AND (attribute_not_exists(migrationMode) OR migrationMode = :no)",
          values: { ":yes": true, ":no": false },
        },
      },
      {
        check: { PK: p.identityPK, SK: "PROFILE" },
        condition: { expression: "userId = :u", values: { ":u": p.id } },
      },
    ];
  }
  async visible(i: Item | undefined) {
    if (!i) return undefined;
    if (i.copyId) {
      const marker = await this.store.get(i.PK, `COPY#${i.copyId}`);
      if (marker?.status !== "complete") return undefined;
    }
    return i;
  }
  async own(p: Principal, kind: string, key: string) {
    id.parse(key);
    const item = await this.visible(
      await this.store.get(`USER#${p.id}`, `${kind}#${key}`),
    );
    if (!item) throw new Failure(404, "Not found");
    return item;
  }
  async list(p: Principal, kind: string, cursor?: string) {
    const page = await this.store.query(
      `USER#${p.id}`,
      `${kind}#`,
      cursor,
      50,
      kind === "HISTORY",
    );
    const items = [];
    for (const item of page.items) {
      const v = await this.visible(item);
      if (v) items.push(publicItem(v));
    }
    return { ...page, items };
  }
  async exercise(p: Principal, key: string) {
    id.parse(key);
    const item =
      (await this.store.get("CATALOG", `EXERCISE#${key}`)) ??
      (await this.visible(
        await this.store.get(`USER#${p.id}`, `EXERCISE#${key}`),
      ));
    if (!item) throw new Failure(404, "Exercise not found");
    return item;
  }
  async receipt(p: Principal, op: string, digest: string) {
    const prior = await this.store.get(`USER#${p.id}`, `OP#${op}`);
    if (prior) {
      if (prior.digest !== digest)
        throw new Failure(409, "Operation ID reused with different input");
      return prior.result;
    }
    return undefined;
  }
  async commit(
    p: Principal,
    body: unknown,
    scope: string,
    make: (
      m: z.infer<typeof mutation>,
    ) => Promise<{ writes: Write[]; result: any }>,
    profileWrite = false,
  ) {
    const m = mutation.parse(body),
      digest = hash(JSON.stringify({ scope, ...m }));
    const old = await this.receipt(p, m.operationId, digest);
    if (old) return old;
    const { writes, result } = await make(m);
    for (const write of writes) if ("put" in write) bounded(write.put);
    bounded({
      PK: `USER#${p.id}`,
      SK: `OP#${m.operationId}`,
      digest,
      result,
      ...metadata(this.now()),
    });
    const guards = this.guard(p).filter(
      (w) =>
        !profileWrite ||
        !(
          "check" in w &&
          w.check.SK === "PROFILE" &&
          w.check.PK === `USER#${p.id}`
        ),
    );
    try {
      await this.store.transact([
        ...guards,
        ...writes,
        {
          put: {
            PK: `USER#${p.id}`,
            SK: `OP#${m.operationId}`,
            digest,
            result,
            ...metadata(this.now()),
          },
          condition: absent,
        },
      ]);
    } catch (e) {
      const raced = await this.receipt(p, m.operationId, digest);
      if (raced) return raced;
      throw e;
    }
    return result;
  }
  async updateProfile(p: Principal, body: unknown) {
    return this.commit(
      p,
      body,
      "me",
      async (m) => {
        const v = z
          .object({ timezone: z.string(), activePlanId: id.nullable() })
          .strict()
          .parse(m.value);
        try {
          validateTimezone(v.timezone);
        } catch {
          throw new Failure(400, "Choose an IANA timezone");
        }
        if (v.activePlanId) await this.own(p, "PLAN", v.activePlanId);
        const current = await this.store.get(`USER#${p.id}`, "PROFILE");
        if (!current?.enabled) throw new Failure(403, "Account disabled");
        const item = {
          ...current,
          ...v,
          revision: m.expectedRevision + 1,
          updatedAt: new Date(this.now()).toISOString(),
        };
        return {
          writes: [
            {
              put: item as Item,
              condition: {
                expression: "#r = :r AND enabled = :yes",
                names: { "#r": "revision" },
                values: { ":r": m.expectedRevision, ":yes": true },
              },
            },
          ],
          result: publicItem(item as Item),
        };
      },
      true,
    );
  }
  async save(
    p: Principal,
    kind: "PLAN" | "EXERCISE",
    key: string,
    body: unknown,
  ) {
    id.parse(key);
    return this.commit(p, body, `${kind}/${key}`, async (m) => {
      const value = (kind === "PLAN" ? plan : exercise).parse(m.value);
      if (value.id !== key) throw new Failure(400, "ID mismatch");
      if (
        kind === "EXERCISE" &&
        (await this.store.get("CATALOG", `EXERCISE#${key}`))
      )
        throw new Failure(409, "Built-in exercises are immutable");
      if (kind === "PLAN")
        for (const eid of new Set(
          (value as z.infer<typeof plan>).days.flatMap((d) =>
            d.exercises.map((e) => e.exerciseId),
          ),
        ))
          await this.exercise(p, eid);
      const current = await this.store.get(`USER#${p.id}`, `${kind}#${key}`);
      if (current && !(await this.visible(current)))
        throw new Failure(404, "Not found");
      if (!current && !z.uuid().safeParse(key).success)
        throw new Failure(400, "New IDs must be UUIDs");
      const item = {
        PK: `USER#${p.id}`,
        SK: `${kind}#${key}`,
        ...value,
        ...metadata(this.now(), m.expectedRevision + 1),
        createdAt: current?.createdAt ?? new Date(this.now()).toISOString(),
      };
      bounded(item);
      return {
        writes: [{ put: item, condition: atRevision(m.expectedRevision) }],
        result: publicItem(item),
      };
    });
  }
  async saveSession(
    p: Principal,
    key: string,
    body: unknown,
    action: "save" | "complete" | "discard" = "save",
    automatic = false,
  ) {
    id.parse(key);
    return this.commit(p, body, `SESSION/${key}/${action}`, async (m) => {
      const current = await this.store.get(`USER#${p.id}`, `SESSION#${key}`);
      if (current && current.status !== "draft")
        throw new Failure(
          409,
          "Session is closed; recover local edits explicitly",
        );
      if (!automatic && !p.profile.timezone)
        throw new Failure(400, "Confirm your timezone first");
      if (current && this.now() >= current.expiresAt && !automatic)
        throw new Failure(
          409,
          "Session expired; recover local edits explicitly",
        );
      const value = session.parse(
        action === "save"
          ? m.value
          : current &&
              Object.fromEntries(
                Object.keys(session.shape).map((k) => [k, current[k]]),
              ),
      ); // Canonical finalization never trusts a stale client snapshot.
      if (value.id !== key) throw new Failure(400, "ID mismatch");
      if (
        current &&
        (value.workoutDate !== current.workoutDate ||
          value.startedAt !== current.startedAt)
      )
        throw new Failure(409, "Session identity is immutable");
      if (!current) {
        if (!z.uuid().safeParse(key).success)
          throw new Failure(400, "New IDs must be UUIDs");
        if (value.workoutDate !== localDate(this.now(), p.profile.timezone!))
          throw new Failure(400, "New session must use today in your timezone");
      }
      if (!automatic) {
        if (value.planId) {
          const selected = await this.own(p, "PLAN", value.planId);
          if (
            value.dayId &&
            !selected.days?.some((d: any) => d.id === value.dayId)
          )
            throw new Failure(404, "Plan day not found");
        }
        for (const e of value.exercises) await this.exercise(p, e.id);
      }
      const timezone = current?.timezone ?? p.profile.timezone!;
      const item: Item = {
        PK: `USER#${p.id}`,
        SK: `SESSION#${key}`,
        ...value,
        ...metadata(this.now(), m.expectedRevision + 1),
        createdAt: current?.createdAt ?? new Date(this.now()).toISOString(),
        timezone,
        expiresAt: current?.expiresAt ?? midnight(value.workoutDate, timezone),
        status:
          action === "save"
            ? "draft"
            : action === "complete"
              ? "completed"
              : "discarded",
      };
      if (action === "save") {
        item.expiryPK = "DRAFT";
        item.expirySK = item.expiresAt;
      } else if (action === "complete") {
        item.completedAt = new Date(this.now()).toISOString();
        item.autoFinalized = automatic;
        item.empty = !value.exercises.some((e) =>
          e.sets.some((s) => s.reps !== "" && s.weight !== ""),
        );
      }
      if (action === "complete" && item.empty && !automatic)
        throw new Failure(400, "Log at least one completed set");
      bounded(item);
      const writes: Write[] = [
        { put: item, condition: atRevision(m.expectedRevision) },
      ];
      if (action === "complete")
        writes.push(...projections(item.PK, item as unknown as StoredSession));
      return {
        writes,
        result: {
          id: key,
          revision: item.revision,
          status: item.status,
          expiresAt: item.expiresAt,
        },
      };
    });
  }
  async expire() {
    let cursor;
    let completed = 0,
      quarantined = 0;
    do {
      const page = await this.store.expired(this.now(), cursor);
      cursor = page.cursor;
      for (const hint of page.items) {
        const s = await this.store.get(hint.PK, hint.SK);
        if (!s || s.status !== "draft" || s.expiresAt > this.now()) continue;
        const profile = await this.store.get(s.PK, "PROFILE");
        if (!profile) continue;
        // Expiry is a service operation: disabled users retain drafts until an admin resolves them.
        if (!profile.enabled || profile.migrationMode) continue;
        const parsed = session.safeParse(
          Object.fromEntries(Object.keys(session.shape).map((k) => [k, s[k]])),
        );
        if (!parsed.success) {
          try {
            await this.store.transact([
              {
                put: {
                  ...s,
                  status: "quarantined",
                  expiryPK: undefined,
                  expirySK: undefined,
                  revision: s.revision + 1,
                  quarantinedAt: new Date(this.now()).toISOString(),
                },
                condition: atRevision(s.revision),
              },
            ]);
            quarantined++;
          } catch (e) {
            if (!(e instanceof Failure && e.status === 409)) throw e;
          }
          continue;
        }
        const done = {
          ...s,
          status: "completed",
          completedAt: new Date(this.now()).toISOString(),
          updatedAt: new Date(this.now()).toISOString(),
          autoFinalized: true,
          empty: !parsed.data.exercises.some((e) =>
            e.sets.some((s) => s.reps !== "" && s.weight !== ""),
          ),
          expiryPK: undefined,
          expirySK: undefined,
          revision: s.revision + 1,
        };
        try {
          await this.store.transact([
            { put: done as Item, condition: atRevision(s.revision) },
            ...projections(s.PK, done as unknown as StoredSession),
          ]);
          completed++;
        } catch (e) {
          if (!(e instanceof Failure && e.status === 409)) throw e;
        }
      }
    } while (cursor);
    return { completed, quarantined };
  }
  async createShare(p: Principal, body: unknown) {
    return this.commit(p, body, "share", async (m) => {
      const v = z
        .object({
          id: z.uuid(),
          kind: z.enum(["PLAN", "SESSION"]),
          sourceId: id,
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        })
        .strict()
        .parse(m.value);
      const source = await this.own(p, v.kind, v.sourceId);
      const ids =
        v.kind === "PLAN"
          ? (source.days as any[]).flatMap((d) =>
              d.exercises.map((e: any) => e.exerciseId),
            )
          : (source.exercises as any[]).map((e) => e.id);
      const customs = [];
      for (const eid of new Set<string>(ids)) {
        const e = await this.exercise(p, eid);
        if (e.PK !== "CATALOG")
          customs.push(
            exercise.parse(
              Object.fromEntries(
                Object.keys(exercise.shape).map((k) => [k, e[k]]),
              ),
            ),
          );
      }
      const snapshot = { kind: v.kind, source: publicItem(source), customs };
      bounded(snapshot);
      const tokenHash = hash(v.token);
      const expiresAt = this.now() + 7 * 86400000;
      return {
        writes: [
          {
            put: {
              PK: `SHARE#${tokenHash}`,
              SK: "SNAPSHOT",
              id: v.id,
              owner: p.id,
              snapshot,
              expiresAt,
              revoked: false,
              ...metadata(this.now()),
            },
            condition: absent,
          },
          {
            put: {
              PK: `USER#${p.id}`,
              SK: `SHARE#${v.id}`,
              id: v.id,
              tokenHash,
              expiresAt,
              revoked: false,
              ...metadata(this.now()),
            },
            condition: absent,
          },
        ],
        result: { id: v.id, expiresAt, revision: 1 },
      };
    });
  }
  async revoke(p: Principal, key: string, body: unknown) {
    return this.commit(p, body, `revoke/${key}`, async (m) => {
      const pointer = await this.own(p, "SHARE", key),
        s = await this.store.get(`SHARE#${pointer.tokenHash}`, "SNAPSHOT");
      if (!s) throw new Failure(404, "Not found");
      return {
        writes: [
          {
            put: { ...s, revoked: true, revision: s.revision + 1 },
            condition: atRevision(m.expectedRevision),
          },
          {
            put: { ...pointer, revoked: true, revision: pointer.revision + 1 },
            condition: atRevision(m.expectedRevision),
          },
        ],
        result: { id: key, revoked: true, revision: s.revision + 1 },
      };
    });
  }
  async redeem(p: Principal, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new Failure(404, "Link unavailable");
    const share = await this.store.get(`SHARE#${hash(token)}`, "SNAPSHOT");
    if (!share || share.revoked || share.expiresAt <= this.now())
      throw new Failure(404, "Link unavailable");
    const PK = `USER#${p.id}`,
      copyId = share.id;
    const prior = await this.store.get(PK, `COPY#${copyId}`);
    if (prior?.status === "complete") return prior.result;
    const source = share.snapshot.source;
    const map = new Map<string, string>(
      (share.snapshot.customs as any[]).map((e) => [
        e.id,
        deterministicId(`${p.id}/${copyId}/exercise/${e.id}`),
      ]),
    );
    const resolve = (eid: string) => map.get(eid) ?? eid;
    const newId = deterministicId(`${p.id}/${copyId}/plan`);
    const days =
      share.snapshot.kind === "PLAN"
        ? source.days.map((d: any) => ({
            ...d,
            id: deterministicId(`${p.id}/${copyId}/day/${d.id}`),
            exercises: d.exercises.map((e: any) => ({
              ...e,
              exerciseId: resolve(e.exerciseId),
            })),
          }))
        : [
            {
              id: deterministicId(`${p.id}/${copyId}/day`),
              name: source.dayName,
              dayOfWeek: 1,
              position: 0,
              exercises: source.exercises.map((e: any, position: number) => ({
                exerciseId: resolve(e.id),
                position,
                plannedSets: Math.max(1, e.sets.length),
                repMin: e.repMin,
                repMax: e.repMax,
                perSide: e.perSide,
                supersetGroup: e.supersetGroup,
                supersetPosition: e.supersetPosition,
                restSeconds: e.restSeconds,
              })),
            },
          ];
    const records: Item[] = [
      ...share.snapshot.customs.map((e: any) => ({
        PK,
        SK: `EXERCISE#${resolve(e.id)}`,
        ...e,
        id: resolve(e.id),
        copyId,
        ...metadata(this.now()),
      })),
      {
        PK,
        SK: `PLAN#${newId}`,
        id: newId,
        name: source.name ?? `${source.dayName} template`,
        days,
        copyId,
        ...metadata(this.now()),
      },
    ];
    // Stage invisibly, restartable after any batch. Stable IDs prevent duplicate imports.
    for (let offset = 0; offset < records.length; offset += 20) {
      const batch = [];
      for (const record of records.slice(offset, offset + 20)) {
        bounded(record);
        if (!(await this.store.get(record.PK, record.SK)))
          batch.push({ put: record, condition: absent });
      }
      if (batch.length)
        try {
          await this.store.transact(batch);
        } catch (e) {
          if (!(e instanceof Failure && e.status === 409)) throw e;
        }
    }
    for (const record of records)
      if (!(await this.store.get(record.PK, record.SK)))
        throw new Failure(503, "Copy staging incomplete; retry");
    const result = { planId: newId, copyId };
    try {
      await this.store.transact([
        ...this.guard(p),
        {
          check: { PK: share.PK, SK: share.SK },
          condition: {
            expression: "revoked = :no AND expiresAt > :now",
            values: { ":no": false, ":now": this.now() },
          },
        },
        {
          put: {
            PK,
            SK: `COPY#${copyId}`,
            status: "complete",
            result,
            ...metadata(this.now()),
          },
          condition: absent,
        },
      ]);
    } catch (e) {
      const raced = await this.store.get(PK, `COPY#${copyId}`);
      if (raced?.status === "complete") return raced.result;
      throw e;
    }
    return result;
  }
}
