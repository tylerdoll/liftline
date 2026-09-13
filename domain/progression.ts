export type PerformanceSet = {
  setNumber: number;
  reps: number;
  weight: number;
};
export function progression(latest: PerformanceSet[], repMin = 8, repMax = 12) {
  if (!latest.length)
    return {
      recommendation: "hold" as const,
      recommendedWeight: null,
      lastWeight: null,
      lastSets: [],
      reason: "Log one session to set your baseline.",
    };
  const lastWeight = Math.max(...latest.map((s) => s.weight));
  const increase = latest.every((s) => s.reps >= repMin && s.reps <= repMax);
  return {
    recommendation: increase ? ("increase" as const) : ("decrease" as const),
    recommendedWeight: Math.max(0, lastWeight + (increase ? 5 : -5)),
    lastWeight,
    lastSets: latest,
    reason: increase
      ? `All ${latest.length} sets landed in ${repMin}–${repMax}. Add 5 lb next time.`
      : `At least one set missed ${repMin}–${repMax}. Pull back 5 lb and own the range.`,
  };
}
