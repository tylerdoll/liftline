import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const exercises = sqliteTable("exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  muscle: text("muscle").notNull(),
  equipment: text("equipment").notNull(),
});

export const plans = sqliteTable("plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const planDays = sqliteTable("plan_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  position: integer("position").notNull(),
});

export const planDayExercises = sqliteTable("plan_day_exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayId: integer("day_id").notNull().references(() => planDays.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
  plannedSets: integer("planned_sets").notNull().default(3),
  position: integer("position").notNull(),
  repMin: integer("rep_min").notNull().default(8),
  repMax: integer("rep_max").notNull().default(12),
  perSide: integer("per_side", { mode: "boolean" }).notNull().default(false),
  supersetGroup: integer("superset_group"),
  supersetPosition: text("superset_position"),
  restSeconds: integer("rest_seconds").notNull().default(120),
});

export const workouts = sqliteTable("workouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  planId: integer("plan_id").references(() => plans.id),
  dayId: integer("day_id").references(() => planDays.id),
  workoutDate: text("workout_date").notNull().default(sql`CURRENT_DATE`),
  completedAt: text("completed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  sourceDraftId: integer("source_draft_id"),
}, (table) => [
  uniqueIndex("idx_workouts_source_draft_id").on(table.sourceDraftId),
]);

export const workoutSets = sqliteTable("workout_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workoutId: integer("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: integer("exercise_id").notNull().references(() => exercises.id),
  setNumber: integer("set_number").notNull(),
  reps: integer("reps").notNull(),
  weight: real("weight").notNull(),
});

export const workoutDrafts = sqliteTable("workout_drafts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workoutDate: text("workout_date").notNull().unique(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
