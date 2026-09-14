import { progression } from "../domain/progression";
export function presentDashboard(
  catalog: any[],
  customs: any[],
  plans: any[],
  sessions: any[],
  weeks: any[],
  me: any,
) {
  const completed = sessions
    .filter((s) => s.status === "completed")
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const progress = new Map<string, any[]>();
  const history: Record<string, any[]> = {};
  for (const s of completed) {
    for (const e of s.exercises ?? []) {
      const sets = e.sets.filter((s: any) => s.reps !== "" && s.weight !== "");
      if (!sets.length) continue;
      if (!progress.has(e.id)) progress.set(e.id, sets);
      (history[e.id] ??= []).push({
        date: s.workoutDate,
        weight: Math.max(...sets.map((s: any) => s.weight)),
        volume: sets.reduce((v: number, s: any) => v + s.weight * s.reps, 0),
      });
    }
  }
  const decorate = (e: any, min = 8, max = 12) => ({
    ...e,
    ...progression(progress.get(e.id) ?? [], min, max),
    repMin: min,
    repMax: max,
    perSide: false,
  });
  const assignments = new Map<string, any>(
    (plans.find((p: any) => p.id === me.activePlanId)?.days ?? [])
      .flatMap((d: any) => d.exercises)
      .sort((a: any, b: any) => a.position - b.position)
      .map((a: any) => [a.exerciseId, a]),
  );
  const exercises = [...catalog, ...customs].map((e) => {
    const a = assignments.get(e.id);
    return {
      ...decorate(e, a?.repMin, a?.repMax),
      perSide: Boolean(a?.perSide),
    };
  });
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const decoratedPlans = plans.map((p) => ({
    ...p,
    isActive: p.id === me.activePlanId,
    days: p.days.map((d: any) => ({
      ...d,
      exercises: d.exercises.map((a: any) => ({
        ...decorate(byId.get(a.exerciseId), a.repMin, a.repMax),
        ...a,
        id: a.exerciseId,
      })),
    })),
  }));
  return {
    exercises,
    plans: decoratedPlans,
    sessions: completed.map((s) => ({
      ...s,
      sets: s.exercises.flatMap((e: any) =>
        e.sets
          .filter((x: any) => x.reps !== "" && x.weight !== "")
          .map((x: any) => ({ ...x, exerciseId: e.id, exerciseName: e.name })),
      ),
    })),
    workoutDrafts: sessions
      .filter((s) => s.status === "draft")
      .map((s) => ({ ...s, draftId: s.id })),
    history: Object.fromEntries(
      Object.entries(history).map(([k, v]) => [
        k,
        v.sort((a, b) => a.date.localeCompare(b.date)).slice(-8),
      ]),
    ),
    stats: {
      workouts: weeks.reduce((n, w) => n + w.workouts, 0),
      weeklyVolume: Math.round(
        completed
          .filter(
            (s) =>
              s.workoutDate >=
              new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
          )
          .reduce(
            (n, s) =>
              n +
              s.exercises.reduce(
                (v: number, e: any) =>
                  v +
                  e.sets.reduce(
                    (v: number, x: any) =>
                      v + Number(x.reps) * Number(x.weight),
                    0,
                  ),
                0,
              ),
            0,
          ),
      ),
      streak: Math.min(12, weeks.length),
    },
  };
}
