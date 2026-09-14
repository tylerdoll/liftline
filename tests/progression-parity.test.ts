import { test } from "node:test";
import assert from "node:assert/strict";
import { legacy } from "./support/legacy";
import { progression } from "../domain/progression";
import { presentDashboard } from "../frontend/dashboard";

test("dashboard uses the active plan range and per-side setting in the exercise library", () => {
  const data = presentDashboard(
    [{ id: "press", name: "Synthetic Press" }],
    [],
    [
      {
        id: "active",
        days: [
          {
            exercises: [
              {
                exerciseId: "press",
                position: 0,
                repMin: 6,
                repMax: 10,
                perSide: true,
              },
            ],
          },
        ],
      },
    ],
    [
      {
        id: "session",
        status: "completed",
        completedAt: "2040-06-10T12:00:00Z",
        workoutDate: "2040-06-10",
        exercises: [
          { id: "press", sets: [{ setNumber: 1, reps: 6, weight: 37.25 }] },
        ],
      },
    ],
    [{ workouts: 1 }],
    { activePlanId: "active" },
  );
  assert.equal(data.exercises[0].recommendedWeight, 42.25);
  assert.equal(data.exercises[0].repMin, 6);
  assert.equal(data.exercises[0].repMax, 10);
  assert.equal(data.exercises[0].perSide, true);
  assert.equal(data.plans[0].days[0].exercises[0].recommendedWeight, 42.25);
  assert.equal(data.stats.weeklyVolume, 224);
});
for (const reps of [
  [8, 12],
  [12, 12],
  [7, 10],
  [13, 10],
  [0, 0],
])
  test(`progression interface matches original API for ${reps.join("/")}`, async () => {
    const c = await legacy();
    try {
      const p = await (
        await c.request({
          action: "createPlan",
          name: "Parity Fixture",
          days: [
            {
              name: "Parity Day",
              dayOfWeek: 1,
              exercises: [
                { exerciseId: 1, plannedSets: 2, repMin: 8, repMax: 12 },
              ],
            },
          ],
        })
      ).json();
      const before = await (await c.request()).json();
      const day = before.plans.find((x: any) => x.id === p.planId).days[0];
      const sets = reps.map((reps, i) => ({
        exerciseId: 1,
        setNumber: i + 1,
        reps,
        weight: 37,
      }));
      await c.request({
        action: "logWorkout",
        planId: p.planId,
        dayId: day.id,
        workoutDate: "2040-06-10",
        sets,
      });
      const after = await (await c.request()).json();
      const old = after.exercises.find((e: any) => e.id === 1),
        next = progression(
          sets.map(({ setNumber, reps, weight }) => ({
            setNumber,
            reps,
            weight,
          })),
        );
      for (const key of [
        "recommendation",
        "recommendedWeight",
        "lastWeight",
        "lastSets",
        "reason",
      ])
        assert.deepEqual(next[key as keyof typeof next], old[key]);
    } finally {
      c.close();
    }
  });
