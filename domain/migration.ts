import { hash, deterministicId, metadata, projections } from "./service";
import { type Store, type Item, absent } from "./store";
import { midnight } from "./time";
import type { StoredSession } from "../contracts";
export const tables = [
  "exercises",
  "plans",
  "plan_days",
  "plan_day_exercises",
  "workouts",
  "workout_sets",
  "workout_drafts",
] as const;
export type LegacyExport = {
  format: string;
  createdAt: string;
  schema: unknown[];
  tables: { name: string; rows: Record<string, any>[] }[];
};
export interface Archive {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string>;
}
export function manifest(data: LegacyExport) {
  if (
    !Array.isArray(data.schema) ||
    !Array.isArray(data.tables) ||
    !data.createdAt
  )
    throw new Error("Invalid export envelope");
  return {
    schemaVersion: 1,
    exportedAt: data.createdAt,
    schemaChecksum: hash(JSON.stringify(data.schema)),
    tables: Object.fromEntries(
      tables.map((name) => {
        const matches = data.tables.filter((t) => t.name === name);
        if (matches.length !== 1 || !Array.isArray(matches[0].rows))
          throw new Error(`Missing or repeated table: ${name}`);
        return [
          name,
          {
            count: matches[0].rows.length,
            checksum: hash(JSON.stringify(matches[0].rows)),
          },
        ];
      }),
    ),
    checksum: hash(JSON.stringify(data)),
  };
}
export async function importLegacy(
  store: Store,
  archive: Archive,
  owner: string,
  data: LegacyExport,
) {
  const m = manifest(data),
    prefix = `private/${owner}/${m.checksum}`,
    PK = `USER#${owner}`,
    now = Date.parse(data.createdAt);
  if (!Number.isFinite(now)) throw new Error("Invalid export timestamp");
  const existingProfile = await store.get(PK, "PROFILE");
  if (existingProfile && !existingProfile.migrationMode)
    throw new Error("Import requires an isolated owner in migration mode");
  const raw = JSON.stringify(data);
  await archive.put(`${prefix}/source.json`, raw);
  if (hash(await archive.get(`${prefix}/source.json`)) !== m.checksum)
    throw new Error("Archive verification failed");
  const byTable = Object.fromEntries(
    tables.map((name) => [
      name,
      data.tables.find((t) => t.name === name)!.rows,
    ]),
  );
  const key = (table: string, id: unknown) =>
    deterministicId(`legacy/${owner}/${table}/${String(id)}`);
  let written = 0,
    unchanged = 0,
    quarantined = 0;
  async function persist(item: Item) {
    const old = await store.get(item.PK, item.SK);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(item))
        throw new Error(
          `Existing target differs at ${item.SK}; use a fresh isolated import target`,
        );
      unchanged++;
      return;
    }
    await store.transact([{ put: item, condition: absent }]);
    written++;
  }
  // Every input row has a durable, lossless address independent of valid relationships.
  for (const table of tables) {
    await archive.put(
      `${prefix}/${table}.json`,
      JSON.stringify(byTable[table]),
    );
    for (const [index, row] of byTable[table].entries()) {
      await persist({
        PK,
        SK: `LEGACY#${table}#${String(index).padStart(10, "0")}`,
        table,
        index,
        legacyId: row.id ?? null,
        archiveKey: `${prefix}/${table}.json`,
        checksum: hash(JSON.stringify(row)),
        ...metadata(now),
      });
    }
  }
  const exMap = new Map(byTable.exercises.map((e) => [e.id, e]));
  const daysByPlan = (planId: unknown) =>
    byTable.plan_days
      .filter((d) => d.plan_id === planId)
      .sort((a, b) => a.position - b.position);
  const assignments = (dayId: unknown) =>
    byTable.plan_day_exercises
      .filter((e) => e.day_id === dayId)
      .sort((a, b) => a.position - b.position)
      .map((a) => ({
        exerciseId: key("exercises", a.exercise_id),
        plannedSets: a.planned_sets,
        position: a.position,
        repMin: a.rep_min,
        repMax: a.rep_max,
        perSide: !!a.per_side,
        supersetGroup: a.superset_group,
        supersetPosition: a.superset_position,
        restSeconds: a.rest_seconds,
        legacy: a,
      }));
  for (const e of byTable.exercises)
    await persist({
      PK,
      SK: `EXERCISE#${key("exercises", e.id)}`,
      id: key("exercises", e.id),
      name: e.name,
      muscle: e.muscle,
      equipment: e.equipment,
      legacy: e,
      ...metadata(now),
    });
  for (const p of byTable.plans) {
    const value = {
      PK,
      SK: `PLAN#${key("plans", p.id)}`,
      id: key("plans", p.id),
      name: p.name,
      days: daysByPlan(p.id).map((d) => ({
        id: key("plan_days", d.id),
        name: d.name,
        dayOfWeek: d.day_of_week,
        position: d.position,
        exercises: assignments(d.id),
        legacy: d,
      })),
      legacy: p,
      ...metadata(now),
      createdAt: p.created_at,
    };
    await canonical(value);
  }
  async function canonical(value: Item) {
    if (Buffer.byteLength(JSON.stringify(value)) <= 200 * 1024) {
      await persist(value);
      return;
    }
    const archiveKey = `${prefix}/${value.SK.replaceAll("#", "-")}.json`;
    await archive.put(archiveKey, JSON.stringify(value));
    await persist({
      PK,
      SK: value.SK,
      id: value.id,
      legacyRef: archiveKey,
      legacyOversized: true,
      ...Object.fromEntries(
        ["status", "name", "dayName", "planName", "workoutDate", "completedAt"]
          .filter((k) => value[k] !== undefined)
          .map((k) => [k, value[k]]),
      ),
      ...metadata(now),
    });
  }
  for (const w of byTable.workouts) {
    const id = key("workouts", w.id),
      sets = byTable.workout_sets.filter((s) => s.workout_id === w.id),
      p = byTable.plans.find((p) => p.id === w.plan_id),
      d = byTable.plan_days.find((d) => d.id === w.day_id);
    const exercises = [...new Set(sets.map((s) => s.exercise_id))].map(
      (eid) => {
        const e = exMap.get(eid);
        return {
          id: key("exercises", eid),
          name: e?.name ?? "Legacy exercise",
          muscle: e?.muscle ?? "",
          equipment: e?.equipment ?? "",
          plannedSets: sets.filter((s) => s.exercise_id === eid).length,
          position: 0,
          repMin: 8,
          repMax: 12,
          perSide: false,
          supersetGroup: null,
          supersetPosition: null,
          restSeconds: 120,
          sets: sets
            .filter((s) => s.exercise_id === eid)
            .map((s) => ({
              setNumber: s.set_number,
              reps: s.reps,
              weight: s.weight,
              legacy: s,
            })),
        };
      },
    );
    const value: Item = {
      PK,
      SK: `SESSION#${id}`,
      id,
      planId: w.plan_id == null ? null : key("plans", w.plan_id),
      dayId: w.day_id == null ? null : key("plan_days", w.day_id),
      planName: p?.name ?? "Legacy plan",
      dayName: d?.name ?? "Legacy workout",
      workoutDate: w.workout_date,
      completedAt: w.completed_at,
      status: "completed",
      timezone: "America/Denver",
      startedAt: 0,
      resumedAt: 0,
      elapsedBeforePause: 0,
      expiresAt: 0,
      exercises,
      legacy: w,
      ...metadata(now),
    };
    await canonical(value);
  }
  const completedDrafts = new Set(
    byTable.workouts.map((w) => w.source_draft_id).filter((x) => x != null),
  );
  for (const d of byTable.workout_drafts) {
    let parsed: any;
    try {
      parsed = JSON.parse(d.payload_json);
      if (!Array.isArray(parsed.exercises)) throw new Error("Malformed");
    } catch {
      await persist({
        PK,
        SK: `QUARANTINE#draft#${key("workout_drafts", d.id)}`,
        reason: "Malformed draft",
        legacy: d,
        ...metadata(now),
      });
      quarantined++;
      continue;
    }
    const id = key("workout_drafts", d.id);
    try {
      const expiry = midnight(d.workout_date, "America/Denver");
      await canonical({
        PK,
        SK: `SESSION#${id}`,
        ...parsed,
        id,
        planId: parsed.planId == null ? null : key("plans", parsed.planId),
        dayId: parsed.dayId == null ? null : key("plan_days", parsed.dayId),
        dayName: parsed.dayName ?? "Legacy draft",
        planName: "Legacy plan",
        workoutDate: d.workout_date,
        timezone: "America/Denver",
        status: completedDrafts.has(d.id) ? "discarded" : "draft",
        expiresAt: expiry,
        ...(!completedDrafts.has(d.id)
          ? { expiryPK: "DRAFT", expirySK: expiry }
          : {}),
        exercises: parsed.exercises.map((e: any) => ({
          ...Object.fromEntries(
            [
              "name",
              "muscle",
              "equipment",
              "plannedSets",
              "position",
              "repMin",
              "repMax",
              "perSide",
              "supersetGroup",
              "supersetPosition",
              "restSeconds",
            ].map((k) => [k, e[k]]),
          ),
          id: key("exercises", e.id),
          sets: Array.isArray(e.sets)
            ? e.sets.map((s: any) => ({
                setNumber: s.setNumber,
                reps: s.reps,
                weight: s.weight,
              }))
            : e.sets,
        })),
        legacy: d,
        ...metadata(now),
      });
    } catch {
      await persist({
        PK,
        SK: `QUARANTINE#draft#${id}`,
        reason: "Unrepresentable draft",
        legacy: d,
        ...metadata(now),
      });
      quarantined++;
    }
  }
  const active = byTable.plans.filter((p) => p.is_active);
  if (active.length > 1) quarantined++;
  await persist({
    PK,
    SK: "PROFILE",
    id: owner,
    enabled: true,
    migrationMode: true,
    timezone: "America/Denver",
    activePlanId: active.length === 1 ? key("plans", active[0].id) : null,
    ...metadata(now),
  });
  await persist({
    PK,
    SK: `MIGRATION#${m.checksum}`,
    manifest: m,
    quarantined,
    ...metadata(now),
  });
  return { manifest: m, written, unchanged, quarantined };
}
// Rebuild into an empty derived namespace, in an isolated table or frozen owner.
// Per-session markers make counters safe across interrupted/repeated runs.
export async function rebuildDerived(
  store: Store,
  archive: Archive,
  owner: string,
) {
  const PK = `USER#${owner}`;
  let cursor;
  let count = 0;
  do {
    const page = await store.query(PK, "SESSION#", cursor);
    cursor = page.cursor;
    for (let s of page.items) {
      if (s.legacyRef) s = JSON.parse(await archive.get(s.legacyRef));
      if (s.status !== "completed") continue;
      const marker = `REBUILD#${s.id}`;
      if (await store.get(PK, marker)) continue;
      const actions = projections(PK, s as unknown as StoredSession);
      // Legacy outliers can exceed transaction limits; build each deterministic
      // projection independently, then transactionally credit WEEK with a marker.
      for (const a of actions.filter((a) => "put" in a)) {
        if ("put" in a) {
          const old = await store.get(PK, a.put.SK);
          if (!old) {
            if (Buffer.byteLength(JSON.stringify(a.put)) > 300 * 1024) {
              const ref = `private/${owner}/derived/${hash(JSON.stringify(a.put))}.json`;
              await archive.put(ref, JSON.stringify(a.put));
              a.put = { PK, SK: a.put.SK, sessionId: s.id, legacyRef: ref };
            }
            await store.transact([a]);
          }
        }
      }
      await store.transact([
        ...actions.filter((a) => "update" in a),
        { put: { PK, SK: marker, sessionId: s.id }, condition: absent },
      ]);
      count++;
    }
  } while (cursor);
  return count;
}
