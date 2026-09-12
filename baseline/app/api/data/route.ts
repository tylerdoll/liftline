import { env } from "cloudflare:workers";

type ExerciseRow = { id: number; name: string; muscle: string; equipment: string };
type PlanRow = { id: number; name: string; is_active: number };
type DayRow = { id: number; plan_id: number; name: string; day_of_week: number; position: number };
type PlanExerciseRow = ExerciseRow & {
  day_id: number;
  planned_sets: number;
  position: number;
  rep_min: number;
  rep_max: number;
  per_side: number;
  superset_group: number | null;
  superset_position: string | null;
  rest_seconds: number;
};
type SetRow = { workout_id: number; exercise_id: number; set_number: number; reps: number; weight: number; workout_date: string };
type HistoryRow = { exercise_id: number; workout_date: string; weight: number; volume: number };
type WorkoutRow = { id: number; plan_id: number | null; day_id: number | null; day_name: string; plan_name: string; workout_date: string; completed_at: string };
type WorkoutSetDetailRow = { workout_id: number; exercise_id: number; exercise_name: string; set_number: number; reps: number; weight: number };
type WorkoutDraftRow = { id: number; workout_date: string; payload_json: string; updated_at: string };
type StoredDraftSet = { setNumber?: unknown; reps?: unknown; weight?: unknown };
type StoredDraftExercise = { id?: unknown; sets?: unknown };
type StoredDraftWorkout = { planId?: unknown; dayId?: unknown; exercises?: unknown };

const exerciseSeed = [
  ["Barbell Bench Press", "Chest", "Barbell"],
  ["Incline Dumbbell Press", "Chest", "Dumbbells"],
  ["Cable Fly", "Chest", "Cable"],
  ["Pull Up", "Back", "Bodyweight"],
  ["Chest-Supported Row", "Back", "Dumbbells"],
  ["Lat Pulldown", "Back", "Cable"],
  ["Single-Arm Cable Row", "Back", "Cable"],
  ["Seated Dumbbell Press", "Shoulders", "Dumbbells"],
  ["Cable Lateral Raise", "Shoulders", "Cable"],
  ["Rear Delt Fly", "Shoulders", "Machine"],
  ["Dumbbell Curl", "Biceps", "Dumbbells"],
  ["Hammer Curl", "Biceps", "Dumbbells"],
  ["Cable Triceps Pressdown", "Triceps", "Cable"],
  ["Overhead Triceps Extension", "Triceps", "Cable"],
  ["Back Squat", "Quads", "Barbell"],
  ["Leg Press", "Quads", "Machine"],
  ["Leg Extension", "Quads", "Machine"],
  ["Romanian Deadlift", "Hamstrings", "Barbell"],
  ["Seated Leg Curl", "Hamstrings", "Machine"],
  ["Hip Thrust", "Glutes", "Barbell"],
  ["Bulgarian Split Squat", "Glutes", "Dumbbells"],
  ["Standing Calf Raise", "Calves", "Machine"],
  ["Cable Crunch", "Core", "Cable"],
  ["Hanging Knee Raise", "Core", "Bodyweight"],
] as const;

function database() {
  if (!env.DB) throw new Error("Training database is not available yet.");
  return env.DB;
}

async function ensureSchema() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      muscle TEXT NOT NULL,
      equipment TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS plan_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      day_of_week INTEGER NOT NULL,
      position INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS plan_day_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      planned_sets INTEGER NOT NULL DEFAULT 3,
      position INTEGER NOT NULL,
      rep_min INTEGER NOT NULL DEFAULT 8,
      rep_max INTEGER NOT NULL DEFAULT 12,
      per_side INTEGER NOT NULL DEFAULT 0,
      superset_group INTEGER,
      superset_position TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 120
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER REFERENCES plans(id),
      day_id INTEGER REFERENCES plan_days(id),
      workout_date TEXT NOT NULL DEFAULT CURRENT_DATE,
      completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source_draft_id INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS workout_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      exercise_id INTEGER NOT NULL REFERENCES exercises(id),
      set_number INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      weight REAL NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS workout_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_date TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_plan_days_plan_id ON plan_days(plan_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_plan_day_exercises_day_id ON plan_day_exercises(day_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_workouts_completed_at ON workouts(completed_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise_workout ON workout_sets(exercise_id, workout_id)"),
  ]);

  const columns = await db.prepare("PRAGMA table_info(plan_day_exercises)").all<{ name: string }>();
  const names = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["rep_min", "ALTER TABLE plan_day_exercises ADD COLUMN rep_min INTEGER NOT NULL DEFAULT 8"],
    ["rep_max", "ALTER TABLE plan_day_exercises ADD COLUMN rep_max INTEGER NOT NULL DEFAULT 12"],
    ["per_side", "ALTER TABLE plan_day_exercises ADD COLUMN per_side INTEGER NOT NULL DEFAULT 0"],
    ["superset_group", "ALTER TABLE plan_day_exercises ADD COLUMN superset_group INTEGER"],
    ["superset_position", "ALTER TABLE plan_day_exercises ADD COLUMN superset_position TEXT"],
    ["rest_seconds", "ALTER TABLE plan_day_exercises ADD COLUMN rest_seconds INTEGER NOT NULL DEFAULT 120"],
  ] as const;
  for (const [name, statement] of additions) {
    if (!names.has(name)) await db.prepare(statement).run();
  }

  const workoutColumns = await db.prepare("PRAGMA table_info(workouts)").all<{ name: string }>();
  if (!workoutColumns.results.some((column: { name: string }) => column.name === "source_draft_id")) {
    await db.prepare("ALTER TABLE workouts ADD COLUMN source_draft_id INTEGER").run();
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_workouts_source_draft_id ON workouts(source_draft_id)").run();
}

async function seedIfEmpty() {
  const db = database();
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM exercises").first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;
  await db.batch(exerciseSeed.map((item) => db.prepare("INSERT INTO exercises (name, muscle, equipment) VALUES (?, ?, ?)").bind(...item)));
}

async function finalizeExpiredDrafts(currentDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) return;
  const db = database();
  const expired = await db.prepare(`SELECT id, workout_date, payload_json, updated_at
    FROM workout_drafts WHERE workout_date < ? ORDER BY workout_date, id`).bind(currentDate).all<WorkoutDraftRow>();

  for (const draft of expired.results) {
    let stored: StoredDraftWorkout;
    try {
      stored = JSON.parse(draft.payload_json) as StoredDraftWorkout;
    } catch {
      await db.prepare("DELETE FROM workout_drafts WHERE id = ?").bind(draft.id).run();
      continue;
    }

    if (!Array.isArray(stored.exercises)) {
      await db.prepare("DELETE FROM workout_drafts WHERE id = ?").bind(draft.id).run();
      continue;
    }

    const planId = Number(stored.planId);
    const dayId = Number(stored.dayId);
    let workout = await db.prepare("SELECT id FROM workouts WHERE source_draft_id = ? LIMIT 1")
      .bind(draft.id).first<{ id: number }>();
    if (!workout) {
      workout = await db.prepare(`INSERT INTO workouts
        (plan_id, day_id, workout_date, completed_at, source_draft_id)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_draft_id) DO NOTHING RETURNING id`)
        .bind(Number.isInteger(planId) && planId > 0 ? planId : null, Number.isInteger(dayId) && dayId > 0 ? dayId : null, draft.workout_date, draft.updated_at, draft.id)
        .first<{ id: number }>();
      workout ??= await db.prepare("SELECT id FROM workouts WHERE source_draft_id = ? LIMIT 1")
        .bind(draft.id).first<{ id: number }>();
    }
    if (!workout) throw new Error("Could not close out an expired workout.");

    const completedSets = (stored.exercises as StoredDraftExercise[]).flatMap((exercise) => {
      const exerciseId = Number(exercise.id);
      if (!Number.isInteger(exerciseId) || exerciseId <= 0 || !Array.isArray(exercise.sets)) return [];
      return (exercise.sets as StoredDraftSet[]).flatMap((set) => {
        if (set.reps === "" || set.weight === "" || set.reps == null || set.weight == null) return [];
        const setNumber = Number(set.setNumber);
        const reps = Number(set.reps);
        const weight = Number(set.weight);
        if (!Number.isFinite(setNumber) || !Number.isFinite(reps) || !Number.isFinite(weight)) return [];
        return [{
          exerciseId,
          setNumber: Math.max(1, Math.floor(setNumber)),
          reps: Math.min(50, Math.max(0, Math.floor(reps))),
          weight: Math.min(2000, Math.max(0, weight)),
        }];
      });
    }).slice(0, 100);

    await db.batch([
      ...completedSets.map((set) => db.prepare(`INSERT INTO workout_sets
        (workout_id, exercise_id, set_number, reps, weight)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM workout_sets WHERE workout_id = ? AND exercise_id = ? AND set_number = ?
        )`)
        .bind(workout.id, set.exerciseId, set.setNumber, set.reps, set.weight, workout.id, set.exerciseId, set.setNumber)),
      db.prepare("DELETE FROM workout_drafts WHERE id = ?").bind(draft.id),
    ]);
  }
}

async function readDashboard(draftDate: string) {
  const db = database();
  const [exerciseResult, planResult, dayResult, planExerciseResult, setResult, historyResult, sessionResult, sessionSetResult, draftResult, workoutCount, weeklyVolume, activeWeeks] = await Promise.all([
    db.prepare("SELECT id, name, muscle, equipment FROM exercises ORDER BY muscle, name").all<ExerciseRow>(),
    db.prepare("SELECT id, name, is_active FROM plans ORDER BY is_active DESC, created_at DESC").all<PlanRow>(),
    db.prepare("SELECT id, plan_id, name, day_of_week, position FROM plan_days ORDER BY position").all<DayRow>(),
    db.prepare(`SELECT pde.day_id, pde.planned_sets, pde.position, pde.rep_min, pde.rep_max,
      pde.per_side, pde.superset_group, pde.superset_position, pde.rest_seconds,
      e.id, e.name, e.muscle, e.equipment
      FROM plan_day_exercises pde JOIN exercises e ON e.id = pde.exercise_id ORDER BY pde.position`).all<PlanExerciseRow>(),
    db.prepare(`SELECT ws.workout_id, ws.exercise_id, ws.set_number, ws.reps, ws.weight, w.workout_date
      FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id ORDER BY w.completed_at DESC, ws.set_number`).all<SetRow>(),
    db.prepare(`SELECT ws.exercise_id, w.workout_date, MAX(ws.weight) AS weight, SUM(ws.weight * ws.reps) AS volume
      FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id
      GROUP BY ws.exercise_id, w.id, w.workout_date ORDER BY w.workout_date ASC`).all<HistoryRow>(),
    db.prepare(`SELECT w.id, w.plan_id, w.day_id, COALESCE(pd.name, 'Workout') AS day_name,
      COALESCE(p.name, 'Training plan') AS plan_name, w.workout_date, w.completed_at
      FROM workouts w
      LEFT JOIN plan_days pd ON pd.id = w.day_id
      LEFT JOIN plans p ON p.id = w.plan_id
      ORDER BY w.workout_date DESC, w.completed_at DESC LIMIT 100`).all<WorkoutRow>(),
    db.prepare(`SELECT ws.workout_id, ws.exercise_id, e.name AS exercise_name, ws.set_number, ws.reps, ws.weight
      FROM workout_sets ws JOIN exercises e ON e.id = ws.exercise_id
      WHERE ws.workout_id IN (SELECT id FROM workouts ORDER BY workout_date DESC, completed_at DESC LIMIT 100)
      ORDER BY ws.workout_id DESC, ws.id`).all<WorkoutSetDetailRow>(),
    db.prepare("SELECT id, workout_date, payload_json, updated_at FROM workout_drafts WHERE workout_date = ? LIMIT 1").bind(draftDate).all<WorkoutDraftRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM workouts").first<{ count: number }>(),
    db.prepare("SELECT COALESCE(SUM(ws.weight * ws.reps), 0) AS volume FROM workout_sets ws JOIN workouts w ON w.id = ws.workout_id WHERE w.workout_date >= date('now', '-7 days')").first<{ volume: number }>(),
    db.prepare("SELECT COUNT(DISTINCT strftime('%Y-%W', workout_date)) AS count FROM workouts").first<{ count: number }>(),
  ]);

  const latestByExercise = new Map<number, SetRow[]>();
  for (const set of setResult.results) {
    const current = latestByExercise.get(set.exercise_id);
    if (!current) latestByExercise.set(set.exercise_id, [set]);
    else if (current[0].workout_id === set.workout_id) current.push(set);
  }

  function withProgression(exercise: ExerciseRow, repMin: number, repMax: number) {
    const latest = latestByExercise.get(exercise.id) ?? [];
    if (!latest.length) return { ...exercise, recommendation: "hold" as const, recommendedWeight: null, lastWeight: null, lastSets: [], reason: "Log one session to set your baseline." };
    const lastWeight = Math.max(...latest.map((set) => set.weight));
    const allInRange = latest.every((set) => set.reps >= repMin && set.reps <= repMax);
    const recommendedWeight = Math.max(0, lastWeight + (allInRange ? 5 : -5));
    return {
      ...exercise,
      recommendation: allInRange ? "increase" as const : "decrease" as const,
      recommendedWeight,
      lastWeight,
      lastSets: latest.map((set) => ({ setNumber: set.set_number, weight: set.weight, reps: set.reps })),
      reason: allInRange ? `All ${latest.length} sets landed in ${repMin}–${repMax}. Add 5 lb next time.` : `At least one set missed ${repMin}–${repMax}. Pull back 5 lb and own the range.`,
    };
  }

  const activePlanId = planResult.results.find((plan) => Boolean(plan.is_active))?.id;
  const activeDayIds = new Set(dayResult.results.filter((day) => day.plan_id === activePlanId).map((day) => day.id));
  const activeAssignments = new Map(planExerciseResult.results.filter((item) => activeDayIds.has(item.day_id)).map((item) => [item.id, item]));
  const decorated = exerciseResult.results.map((exercise) => {
    const assignment = activeAssignments.get(exercise.id);
    return {
      ...withProgression(exercise, assignment?.rep_min ?? 8, assignment?.rep_max ?? 12),
      repMin: assignment?.rep_min ?? 8,
      repMax: assignment?.rep_max ?? 12,
      perSide: Boolean(assignment?.per_side),
    };
  });
  const exerciseMap = new Map(exerciseResult.results.map((exercise) => [exercise.id, exercise]));
  const plans = planResult.results.map((plan) => ({
    id: plan.id,
    name: plan.name,
    isActive: Boolean(plan.is_active),
    days: dayResult.results.filter((day) => day.plan_id === plan.id).map((day) => ({
      id: day.id,
      name: day.name,
      dayOfWeek: day.day_of_week,
      position: day.position,
      exercises: planExerciseResult.results.filter((item) => item.day_id === day.id).map((item) => ({
        ...withProgression(exerciseMap.get(item.id)!, item.rep_min, item.rep_max),
        plannedSets: item.planned_sets,
        position: item.position,
        repMin: item.rep_min,
        repMax: item.rep_max,
        perSide: Boolean(item.per_side),
        supersetGroup: item.superset_group,
        supersetPosition: item.superset_position,
        restSeconds: item.rest_seconds,
      })),
    })),
  }));

  const history: Record<string, Array<{ date: string; weight: number; volume: number }>> = {};
  for (const point of historyResult.results) {
    const key = String(point.exercise_id);
    history[key] = [
      ...(history[key] ?? []),
      {
        date: point.workout_date,
        weight: Number(point.weight),
        volume: Number(point.volume),
      },
    ].slice(-8);
  }

  const sessionSets = new Map<number, WorkoutSetDetailRow[]>();
  for (const set of sessionSetResult.results) {
    sessionSets.set(set.workout_id, [...(sessionSets.get(set.workout_id) ?? []), set]);
  }
  const sessions = sessionResult.results.map((session) => ({
    id: session.id,
    planId: session.plan_id,
    dayId: session.day_id,
    dayName: session.day_name,
    planName: session.plan_name,
    workoutDate: session.workout_date,
    completedAt: session.completed_at,
    sets: (sessionSets.get(session.id) ?? []).map((set) => ({
      exerciseId: set.exercise_id,
      exerciseName: set.exercise_name,
      setNumber: set.set_number,
      reps: set.reps,
      weight: Number(set.weight),
    })),
  }));

  const workoutDrafts = draftResult.results.flatMap((draft) => {
    try {
      const stored = JSON.parse(draft.payload_json) as Record<string, unknown>;
      if (!Array.isArray(stored.exercises)) return [];
      return [{ ...stored, draftId: draft.id, workoutDate: draft.workout_date, updatedAt: draft.updated_at }];
    } catch {
      return [];
    }
  });

  return {
    exercises: decorated,
    plans,
    sessions,
    workoutDrafts,
    stats: { workouts: workoutCount?.count ?? 0, weeklyVolume: Math.round(weeklyVolume?.volume ?? 0), streak: Math.min(12, activeWeeks?.count ?? 0) },
    history,
  };
}

export async function GET(request: Request) {
  try {
    await ensureSchema();
    await seedIfEmpty();
    const requestedDate = new URL(request.url).searchParams.get("date") ?? "";
    const draftDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : "";
    await finalizeExpiredDrafts(draftDate);
    return Response.json(await readDashboard(draftDate));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load training data." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const db = database();
    const payload = await request.json() as Record<string, unknown>;

    if (payload.action === "activatePlan") {
      const planId = Number(payload.planId);
      if (!Number.isInteger(planId)) return Response.json({ error: "A valid plan is required." }, { status: 400 });
      await db.batch([db.prepare("UPDATE plans SET is_active = 0"), db.prepare("UPDATE plans SET is_active = 1 WHERE id = ?").bind(planId)]);
      return Response.json({ ok: true });
    }

    if (payload.action === "createPlan") {
      const name = String(payload.name ?? "").trim().slice(0, 80);
      const days = Array.isArray(payload.days) ? payload.days as Array<Record<string, unknown>> : [];
      if (!name || !days.length) return Response.json({ error: "Add a plan name and at least one day." }, { status: 400 });
      const plan = await db.prepare("INSERT INTO plans (name, is_active) VALUES (?, 0) RETURNING id").bind(name).first<{ id: number }>();
      if (!plan) throw new Error("Could not create the plan.");
      for (const [dayIndex, rawDay] of days.slice(0, 7).entries()) {
        const day = await db.prepare("INSERT INTO plan_days (plan_id, name, day_of_week, position) VALUES (?, ?, ?, ?) RETURNING id")
          .bind(plan.id, String(rawDay.name ?? `Workout ${dayIndex + 1}`).slice(0, 40), Math.min(6, Math.max(0, Number(rawDay.dayOfWeek))), dayIndex).first<{ id: number }>();
        const items = Array.isArray(rawDay.exercises) ? rawDay.exercises as Array<Record<string, unknown>> : [];
        if (day && items.length) {
          await db.batch(items.slice(0, 20).map((item, position) => db.prepare(`INSERT INTO plan_day_exercises
            (day_id, exercise_id, planned_sets, position, rep_min, rep_max, per_side, superset_group, superset_position, rest_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(
              day.id,
              Number(item.exerciseId),
              Math.min(8, Math.max(1, Number(item.plannedSets) || 3)),
              position,
              Math.min(50, Math.max(1, Number(item.repMin) || 8)),
              Math.min(50, Math.max(1, Number(item.repMax) || 12)),
              item.perSide ? 1 : 0,
              item.supersetGroup == null ? null : Number(item.supersetGroup),
              item.supersetPosition == null ? null : String(item.supersetPosition).slice(0, 1),
              Math.min(600, Math.max(0, Number(item.restSeconds) || 120)),
            )));
        }
      }
      return Response.json({ ok: true, planId: plan.id }, { status: 201 });
    }

    if (payload.action === "saveWorkoutDraft") {
      const rawWorkout = payload.workout;
      if (!rawWorkout || typeof rawWorkout !== "object" || Array.isArray(rawWorkout)) return Response.json({ error: "A workout is required." }, { status: 400 });
      const workout = rawWorkout as Record<string, unknown>;
      const workoutDate = String(workout.workoutDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(workoutDate) || !Array.isArray(workout.exercises) || !workout.exercises.length) {
        return Response.json({ error: "The workout draft is incomplete." }, { status: 400 });
      }
      const storedWorkout = {
        planId: Number(workout.planId),
        dayId: Number(workout.dayId),
        dayName: String(workout.dayName ?? "Workout").slice(0, 80),
        startedAt: Math.max(0, Number(workout.startedAt) || Date.now()),
        resumedAt: Math.max(0, Number(workout.resumedAt) || Date.now()),
        elapsedBeforePause: Math.max(0, Math.floor(Number(workout.elapsedBeforePause) || 0)),
        exercises: workout.exercises.slice(0, 30),
      };
      const serialized = JSON.stringify(storedWorkout);
      if (serialized.length > 200_000) return Response.json({ error: "The workout draft is too large." }, { status: 413 });
      const alreadyFinished = await db.prepare(`SELECT id FROM workouts
        WHERE day_id = ? AND workout_date = ? AND completed_at >= datetime(?, 'unixepoch')
        LIMIT 1`).bind(storedWorkout.dayId, workoutDate, Math.floor(storedWorkout.startedAt / 1000)).first<{ id: number }>();
      if (alreadyFinished) return Response.json({ ok: true, skipped: true });
      const draft = await db.prepare(`INSERT INTO workout_drafts (workout_date, payload_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(workout_date) DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP
        RETURNING id`).bind(workoutDate, serialized).first<{ id: number }>();
      if (!draft) throw new Error("Could not pause the workout.");
      return Response.json({ ok: true, draftId: draft.id });
    }

    if (payload.action === "discardWorkoutDraft") {
      const draftId = Number(payload.draftId);
      if (!Number.isInteger(draftId) || draftId <= 0) return Response.json({ error: "A valid paused workout is required." }, { status: 400 });
      await db.prepare("DELETE FROM workout_drafts WHERE id = ?").bind(draftId).run();
      return Response.json({ ok: true });
    }

    if (payload.action === "logWorkout") {
      const sets = Array.isArray(payload.sets) ? payload.sets as Array<Record<string, unknown>> : [];
      if (!sets.length) return Response.json({ error: "Log at least one completed set." }, { status: 400 });
      const requestedDate = String(payload.workoutDate ?? "");
      const workoutDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
      const workout = await db.prepare("INSERT INTO workouts (plan_id, day_id, workout_date) VALUES (?, ?, COALESCE(?, CURRENT_DATE)) RETURNING id")
        .bind(Number(payload.planId) || null, Number(payload.dayId) || null, workoutDate).first<{ id: number }>();
      if (!workout) throw new Error("Could not save the workout.");
      await db.batch([
        ...sets.slice(0, 100).map((set) => db.prepare("INSERT INTO workout_sets (workout_id, exercise_id, set_number, reps, weight) VALUES (?, ?, ?, ?, ?)")
          .bind(workout.id, Number(set.exerciseId), Math.max(1, Number(set.setNumber)), Math.min(50, Math.max(0, Number(set.reps))), Math.min(2000, Math.max(0, Number(set.weight))))),
        db.prepare("DELETE FROM workout_drafts WHERE workout_date = ?").bind(workoutDate ?? ""),
      ]);
      return Response.json({ ok: true, workoutId: workout.id }, { status: 201 });
    }

    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save changes." }, { status: 500 });
  }
}
