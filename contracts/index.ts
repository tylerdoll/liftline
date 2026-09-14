import { z } from "zod";
export const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const uuid = z.uuid();
export const revision = z.number().int().nonnegative();
export const exercise = z
  .object({
    id,
    name: z.string().trim().min(1).max(160),
    muscle: z.string().min(1).max(80),
    equipment: z.string().min(1).max(80),
  })
  .strict();
export const assignment = z
  .object({
    exerciseId: id,
    plannedSets: z.number().int().min(1).max(100),
    position: z.number().int().nonnegative(),
    repMin: z.number().int().min(0).max(50),
    repMax: z.number().int().min(0).max(50),
    perSide: z.boolean(),
    supersetGroup: z.number().int().positive().nullable(),
    supersetPosition: z.string().max(8).nullable(),
    restSeconds: z.number().int().min(0).max(3600),
  })
  .strict()
  .refine((x) => x.repMax >= x.repMin);
export const day = z
  .object({
    id,
    name: z.string().min(1).max(160),
    dayOfWeek: z.number().int().min(0).max(6),
    position: z.number().int().nonnegative(),
    exercises: z.array(assignment).max(30),
  })
  .strict()
  .refine(
    (d) =>
      new Set(d.exercises.map((e) => e.exerciseId)).size === d.exercises.length,
    "Duplicate exercises",
  )
  .refine(
    (d) => d.exercises.reduce((n, e) => n + e.plannedSets, 0) <= 100,
    "A day may plan at most 100 sets",
  );
export const plan = z
  .object({
    id,
    name: z.string().min(1).max(160),
    days: z.array(day).min(1).max(14),
  })
  .strict()
  .refine(
    (p) => new Set(p.days.map((d) => d.id)).size === p.days.length,
    "Duplicate day IDs",
  );
export const set = z
  .object({
    setNumber: z.number().int().min(1).max(100),
    reps: z.union([z.literal(""), z.number().int().min(0).max(50)]),
    weight: z.union([z.literal(""), z.number().min(0).max(2000)]),
  })
  .strict();
export const sessionExercise = exercise
  .extend({
    plannedSets: assignment.shape.plannedSets,
    position: assignment.shape.position,
    repMin: assignment.shape.repMin,
    repMax: assignment.shape.repMax,
    perSide: z.boolean(),
    supersetGroup: assignment.shape.supersetGroup,
    supersetPosition: assignment.shape.supersetPosition,
    restSeconds: assignment.shape.restSeconds,
    sets: z.array(set).max(100),
  })
  .strict();
export const session = z
  .object({
    id,
    planId: id.nullable(),
    dayId: id.nullable(),
    dayName: z.string().max(160),
    planName: z.string().max(160),
    workoutDate: z.iso.date(),
    startedAt: z.number().nonnegative(),
    resumedAt: z.number().nonnegative(),
    elapsedBeforePause: z.number().nonnegative(),
    exercises: z.array(sessionExercise).max(30),
  })
  .strict()
  .superRefine((s, c) => {
    if (new Set(s.exercises.map((e) => e.id)).size !== s.exercises.length)
      c.addIssue({ code: "custom", message: "Duplicate exercises" });
    if (s.exercises.reduce((n, e) => n + e.sets.length, 0) > 100)
      c.addIssue({ code: "custom", message: "Maximum 100 sets" });
    for (const e of s.exercises)
      if (new Set(e.sets.map((s) => s.setNumber)).size !== e.sets.length)
        c.addIssue({ code: "custom", message: "Duplicate set numbers" });
  });
export const mutation = z
  .object({ operationId: uuid, expectedRevision: revision, value: z.unknown() })
  .strict();
export type Exercise = z.infer<typeof exercise>;
export type Plan = z.infer<typeof plan>;
export type Session = z.infer<typeof session>;
export type Envelope = {
  schemaVersion: 1;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type StoredSession = Session &
  Envelope & {
    status: "draft" | "completed" | "discarded" | "quarantined";
    timezone: string;
    expiresAt: number;
    empty?: boolean;
    autoFinalized?: boolean;
    completedAt?: string;
  };
export type Profile = Envelope & {
  id: string;
  enabled: boolean;
  timezone: string | null;
  activePlanId: string | null;
};
export const routes = [
  "me",
  "exercises",
  "plans",
  "sessions",
  "history",
  "progress",
  "shares",
] as const;
