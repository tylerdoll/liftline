"use client";
import {
  legacyFetch as fetch,
  saveDraft,
  scheduleDraft,
  today,
} from "./bridge";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Exercise = {
  id: string;
  name: string;
  muscle: string;
  equipment: string;
  recommendation?: "increase" | "decrease" | "hold";
  recommendedWeight?: number | null;
  lastWeight?: number | null;
  lastSets?: { setNumber: number; weight: number; reps: number }[];
  reason?: string;
  repMin?: number;
  repMax?: number;
  perSide?: boolean;
};

type PlanExercise = Exercise & {
  plannedSets: number;
  position: number;
  repMin: number;
  repMax: number;
  perSide: boolean;
  supersetGroup: number | null;
  supersetPosition: string | null;
  restSeconds: number;
};
type PlanDay = {
  id: string;
  name: string;
  dayOfWeek: number;
  position: number;
  exercises: PlanExercise[];
};
type Plan = { id: string; name: string; isActive: boolean; days: PlanDay[] };
type HistoryPoint = { date: string; weight: number; volume: number };
type SessionSet = {
  exerciseId: string;
  exerciseName: string;
  setNumber: number;
  reps: number;
  weight: number;
};
type WorkoutSession = {
  id: string;
  planId: string | null;
  dayId: string | null;
  dayName: string;
  planName: string;
  workoutDate: string;
  completedAt: string;
  sets: SessionSet[];
};
type DashboardData = {
  exercises: Exercise[];
  plans: Plan[];
  sessions: WorkoutSession[];
  workoutDrafts: WorkoutDraft[];
  stats: { workouts: number; weeklyVolume: number; streak: number };
  history: Record<string, HistoryPoint[]>;
};
type SetEntry = { setNumber: number; reps: number | ""; weight: number | "" };
type ActiveExercise = PlanExercise & {
  sets: SetEntry[];
  swappedFrom?: { id: string; name: string };
};
type ActiveWorkout = {
  id: string;
  planId: string;
  dayId: string;
  dayName: string;
  workoutDate: string;
  startedAt: number;
  resumedAt: number;
  elapsedBeforePause: number;
  exercises: ActiveExercise[];
};
type WorkoutDraft = ActiveWorkout & { draftId: string; updatedAt: string };

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MUSCLE_ORDER = [
  "All",
  "Chest",
  "Back",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Core",
];

const nav = [
  { id: "today", label: "Today", mark: "◆" },
  { id: "plans", label: "Plans", mark: "▤" },
  { id: "exercises", label: "Exercises", mark: "＋" },
  { id: "progress", label: "Progress", mark: "↗" },
] as const;
type View = (typeof nav)[number]["id"];

function displayDay(day: number) {
  return DAYS[day] ?? "Day";
}

function dateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function fullDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Completed session";
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
}

function localDateKey() {
  return today();
}

function pausedSnapshot(
  workout: ActiveWorkout,
  pausedAt = Date.now(),
): ActiveWorkout {
  return {
    ...workout,
    resumedAt: pausedAt,
    elapsedBeforePause:
      workout.elapsedBeforePause +
      Math.max(0, Math.floor((pausedAt - workout.resumedAt) / 1000)),
  };
}

async function saveWorkoutDraft(workout: ActiveWorkout) {
  return saveDraft(workout);
}

function mondayOfWeek(reference = new Date()) {
  const monday = new Date(reference);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function isInWeek(value: string, weekStart: Date) {
  const date = new Date(`${value}T12:00:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return date >= weekStart && date < weekEnd;
}

function formatWeight(value?: number | null) {
  return value ? `${value} lb` : "—";
}

function formatRepRange(exercise: Partial<PlanExercise>) {
  return `${exercise.repMin ?? 8}–${exercise.repMax ?? 12}${exercise.perSide ? " / side" : ""}`;
}

function setLabel(exercise: Partial<PlanExercise>, fallback: number) {
  return exercise.supersetGroup
    ? `${exercise.supersetGroup}${exercise.supersetPosition ?? ""}`
    : `0${fallback}`;
}

function formatRest(seconds = 120) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatElapsed(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export default function Home({
  refreshSignal = 0,
}: {
  refreshSignal?: number;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [view, setView] = useState<View>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [builderOpen, setBuilderOpen] = useState(false);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(
    null,
  );
  const [selectedSession, setSelectedSession] = useState<WorkoutSession | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const promptedDrafts = useRef(new Set<string>());

  const loadData = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/data?date=${localDateKey()}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as DashboardData & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "Could not load your training data.");
      setData(body);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not load your training data.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial synchronization with the persistent training store.
    // Synchronize the displayed data after an explicit state transition.
    void loadData();
  }, [loadData, refreshSignal]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!activeWorkout) return;
    void scheduleDraft(pausedSnapshot(activeWorkout)).catch(() =>
      setError("Device storage failed; keep this page open."),
    );
  }, [activeWorkout]);

  useEffect(() => {
    if (!activeWorkout) return;
    function protectActiveWorkout(event: BeforeUnloadEvent) {
      const snapshot = pausedSnapshot(activeWorkout!);
      void scheduleDraft(snapshot);
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", protectActiveWorkout);
    return () =>
      window.removeEventListener("beforeunload", protectActiveWorkout);
  }, [activeWorkout]);

  const activePlan =
    data?.plans.find((plan) => plan.isActive) ?? data?.plans[0];
  const todayDraft = data?.workoutDrafts.find(
    (draft) => draft.workoutDate === localDateKey(),
  );
  const todayDay = useMemo(() => {
    if (!activePlan?.days.length) return null;
    const current = new Date().getDay();
    return (
      activePlan.days.find((day) => day.dayOfWeek === current) ??
      activePlan.days[0]
    );
  }, [activePlan]);

  useEffect(() => {
    if (
      !todayDraft ||
      activeWorkout ||
      promptedDrafts.current.has(todayDraft.draftId)
    )
      return;
    promptedDrafts.current.add(todayDraft.draftId);
    if (
      window.confirm(
        `Resume ${todayDraft.dayName}?\n\nThis workout was saved today. Choose OK to resume it now.`,
      )
    ) {
      // Browser-confirmed restoration of the same-day draft.
      // Synchronize the displayed data after an explicit state transition.
      setActiveWorkout({ ...todayDraft, resumedAt: Date.now() });
      return;
    }
    if (
      window.confirm(
        `Discard the saved ${todayDraft.dayName} workout?\n\nChoose OK to discard it, or Cancel to keep it paused for later today.`,
      )
    ) {
      void discardWorkoutDraft(todayDraft, false);
    }
  }, [todayDraft, activeWorkout]);

  function beginWorkout(day: PlanDay) {
    if (!activePlan) return;
    if (todayDraft) {
      resumeWorkout(todayDraft);
      return;
    }
    const startedAt = Date.now();
    setActiveWorkout({
      id: crypto.randomUUID(),
      planId: activePlan.id,
      dayId: day.id,
      dayName: day.name,
      workoutDate: localDateKey(),
      startedAt,
      resumedAt: startedAt,
      elapsedBeforePause: 0,
      exercises: day.exercises.map((exercise) => ({
        ...exercise,
        sets: Array.from({ length: exercise.plannedSets }, (_, index) => ({
          setNumber: index + 1,
          reps: "",
          weight: "",
        })),
      })),
    });
  }

  function resumeWorkout(draft: WorkoutDraft) {
    if (draft.workoutDate !== localDateKey()) {
      setToast("That paused workout can only be resumed on its original day");
      return;
    }
    promptedDrafts.current.add(draft.draftId);
    setActiveWorkout({ ...draft, resumedAt: Date.now() });
  }

  async function pauseWorkout(workout: ActiveWorkout) {
    const draftId = await saveWorkoutDraft(workout);
    promptedDrafts.current.add(draftId);
    setActiveWorkout(null);
    setToast("Workout paused — you can resume it today");
    await loadData();
  }

  async function discardWorkoutDraft(draft: WorkoutDraft, ask = true) {
    if (
      ask &&
      !window.confirm(
        `Discard the paused ${draft.dayName} workout?\n\nThis cannot be undone.`,
      )
    )
      return;
    const response = await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "discardWorkoutDraft",
        draftId: draft.draftId,
      }),
    });
    if (!response.ok) {
      setToast("Could not discard the paused workout");
      return;
    }
    setData((current) =>
      current
        ? {
            ...current,
            workoutDrafts: current.workoutDrafts.filter(
              (item) => item.draftId !== draft.draftId,
            ),
          }
        : current,
    );
    setToast("Paused workout discarded");
  }

  async function activatePlan(planId: string) {
    await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "activatePlan", planId }),
    });
    setToast("Active plan updated");
    await loadData();
  }

  if (loading) return <LoadingScreen />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="side-nav" aria-label="Primary navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => setView(item.id)}
            >
              <span aria-hidden="true">{item.mark}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="pulse-dot" />
          <div>
            <strong>Range method</strong>
            <small>Auto-progression is on</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="eyebrow">
            {new Intl.DateTimeFormat("en", {
              weekday: "long",
              month: "long",
              day: "numeric",
            }).format(new Date())}
          </div>
          <button className="profile-button" aria-label="Profile">
            ●
          </button>
        </header>

        {error ? (
          <div className="error-banner">
            {error}
            <button onClick={() => void loadData()}>Try again</button>
          </div>
        ) : null}
        {data && view === "today" && (
          <TodayView
            data={data}
            activePlan={activePlan}
            day={todayDay}
            workoutDraft={todayDraft}
            onStart={beginWorkout}
            onResume={resumeWorkout}
            onDiscard={(draft) => void discardWorkoutDraft(draft)}
            onOpenPlans={() => setView("plans")}
          />
        )}
        {data && view === "plans" && (
          <PlansView
            plans={data.plans}
            sessions={data.sessions}
            onCreate={() => setBuilderOpen(true)}
            onActivate={(id) => void activatePlan(id)}
            onStart={beginWorkout}
            onOpenSession={setSelectedSession}
          />
        )}
        {data && view === "exercises" && (
          <ExerciseLibrary exercises={data.exercises} />
        )}
        {data && view === "progress" && <ProgressView data={data} />}
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {nav.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => setView(item.id)}
          >
            <span>{item.mark}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {data && builderOpen && (
        <PlanBuilder
          exercises={data.exercises}
          onClose={() => setBuilderOpen(false)}
          onSaved={async () => {
            setBuilderOpen(false);
            setToast("New plan created");
            await loadData();
          }}
        />
      )}
      {data && activeWorkout && (
        <WorkoutLogger
          workout={activeWorkout}
          exercises={data.exercises}
          onChange={setActiveWorkout}
          onPause={pauseWorkout}
          onFinished={async () => {
            setActiveWorkout(null);
            setToast("Workout logged — recommendations updated");
            await loadData();
          }}
        />
      )}
      {selectedSession && (
        <SessionHistoryModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
      {toast ? (
        <div className="toast" role="status">
          <span>✓</span>
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">L</span>
      <span>LIFTLINE</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <Brand />
      <div className="loader" />
      <p>Setting up your training log…</p>
    </div>
  );
}

function TodayView({
  data,
  activePlan,
  day,
  workoutDraft,
  onStart,
  onResume,
  onDiscard,
  onOpenPlans,
}: {
  data: DashboardData;
  activePlan?: Plan;
  day: PlanDay | null;
  workoutDraft?: WorkoutDraft;
  onStart: (day: PlanDay) => void;
  onResume: (draft: WorkoutDraft) => void;
  onDiscard: (draft: WorkoutDraft) => void;
  onOpenPlans: () => void;
}) {
  const volume = data.stats.weeklyVolume.toLocaleString();
  const completedDraftSets =
    workoutDraft?.exercises
      .flatMap((exercise) => exercise.sets)
      .filter((set) => set.reps !== "" && set.weight !== "").length ?? 0;
  const totalDraftSets =
    workoutDraft?.exercises.reduce(
      (total, exercise) => total + exercise.sets.length,
      0,
    ) ?? 0;
  return (
    <div className="page-wrap">
      {workoutDraft ? (
        <section className="paused-workout-banner" aria-label="Paused workout">
          <div className="paused-workout-mark">
            <span>Ⅱ</span>
          </div>
          <div>
            <span className="kicker">
              <span /> PAUSED TODAY
            </span>
            <h2>{workoutDraft.dayName}</h2>
            <p>
              {completedDraftSets} of {totalDraftSets} sets entered ·{" "}
              {formatElapsed(workoutDraft.elapsedBeforePause)} active time
            </p>
          </div>
          <div className="paused-workout-actions">
            <button
              className="primary-button"
              onClick={() => onResume(workoutDraft)}
            >
              Resume workout<span>→</span>
            </button>
            <button
              className="text-button"
              onClick={() => onDiscard(workoutDraft)}
            >
              Discard
            </button>
          </div>
        </section>
      ) : null}
      <section className="hero-grid">
        <div className="hero-copy">
          <div className="kicker">
            <span /> NEXT SESSION ·{" "}
            {activePlan?.name.toUpperCase() ?? "NO ACTIVE PLAN"}
          </div>
          <h1>
            Ready for
            <br />
            <em>the next line?</em>
          </h1>
          <p>
            Your targets are set from your last session. Hit every planned set
            in its programmed rep range and the line moves up.
          </p>
          {workoutDraft ? (
            <div className="hero-actions">
              <button
                className="primary-button"
                onClick={() => onResume(workoutDraft)}
              >
                Resume {workoutDraft.dayName}
                <span>→</span>
              </button>
              <button
                className="text-button"
                onClick={() => onDiscard(workoutDraft)}
              >
                Discard paused workout
              </button>
            </div>
          ) : day ? (
            <div className="hero-actions">
              <button className="primary-button" onClick={() => onStart(day)}>
                Start {day.name}
                <span>→</span>
              </button>
              <button className="text-button" onClick={onOpenPlans}>
                View schedule
              </button>
            </div>
          ) : (
            <button className="primary-button" onClick={onOpenPlans}>
              Build your first plan<span>→</span>
            </button>
          )}
        </div>
        <div className="session-card">
          <div className="session-card-head">
            <span>
              {day
                ? displayDay(day.dayOfWeek).slice(0, 3).toUpperCase()
                : "NEXT"}
            </span>
            <small>{day?.exercises.length ?? 0} movements</small>
          </div>
          <h2>{day?.name ?? "Plan a workout"}</h2>
          <div className="session-list">
            {day?.exercises.slice(0, 6).map((exercise, index) => (
              <div className="session-row" key={exercise.id}>
                <span className="exercise-number">
                  {setLabel(exercise, index + 1)}
                </span>
                <div>
                  <strong>{exercise.name}</strong>
                  <small>
                    {exercise.plannedSets} sets · {formatRepRange(exercise)}{" "}
                    reps
                  </small>
                </div>
                <RecommendationBadge exercise={exercise} compact />
              </div>
            ))}
            {!day?.exercises.length && (
              <div className="empty-mini">
                Add exercises to a scheduled training day.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="stats-row" aria-label="Training stats">
        <StatCard
          label="Sessions logged"
          value={String(data.stats.workouts)}
          detail="all time"
        />
        <StatCard
          label="Weekly volume"
          value={volume}
          detail="lb lifted"
          accent
        />
        <StatCard
          label="Training streak"
          value={`${data.stats.streak} wk`}
          detail="keep the line moving"
        />
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <span className="section-index">01</span>
            <h2>What changed</h2>
          </div>
          <p>Recommendations from your latest completed sets.</p>
        </div>
        <div className="recommendation-grid">
          {day?.exercises.slice(0, 3).map((exercise) => (
            <RecommendationCard key={exercise.id} exercise={exercise} />
          ))}
          {!day?.exercises.length && (
            <EmptyPanel
              title="No recommendations yet"
              text="Complete a workout to unlock your next load targets."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={accent ? "stat-card accent" : "stat-card"}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function RecommendationBadge({
  exercise,
  compact = false,
}: {
  exercise: Exercise;
  compact?: boolean;
}) {
  const kind = exercise.recommendation ?? "hold";
  const labels = {
    increase: compact ? "↑" : "Increase",
    decrease: compact ? "↓" : "Decrease",
    hold: compact ? "—" : "Establish",
  };
  return <span className={`recommendation-badge ${kind}`}>{labels[kind]}</span>;
}

function RecommendationCard({ exercise }: { exercise: Exercise }) {
  return (
    <article className="recommendation-card">
      <div className="card-top">
        <span className="muscle-pill">{exercise.muscle}</span>
        <RecommendationBadge exercise={exercise} />
      </div>
      <h3>{exercise.name}</h3>
      <div className="load-shift">
        <span>{formatWeight(exercise.lastWeight)}</span>
        <b>→</b>
        <strong>{formatWeight(exercise.recommendedWeight)}</strong>
      </div>
      <p>
        {exercise.reason ?? "Complete a set to establish your training line."}
      </p>
    </article>
  );
}

function PlansView({
  plans,
  sessions,
  onCreate,
  onActivate,
  onStart,
  onOpenSession,
}: {
  plans: Plan[];
  sessions: WorkoutSession[];
  onCreate: () => void;
  onActivate: (id: string) => void;
  onStart: (day: PlanDay) => void;
  onOpenSession: (session: WorkoutSession) => void;
}) {
  const weekStart = mondayOfWeek();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekLabel = `${dateLabel(weekStart.toISOString().slice(0, 10))}–${dateLabel(weekEnd.toISOString().slice(0, 10))}`;

  return (
    <div className="page-wrap subpage">
      <div className="page-title-row">
        <div>
          <div className="kicker">
            <span /> THIS WEEK · {weekLabel}
          </div>
          <h1>Your plans</h1>
          <p>
            Completed sessions stay on your line. Each Monday starts a fresh
            training week.
          </p>
        </div>
        <button className="primary-button" onClick={onCreate}>
          Create plan<span>＋</span>
        </button>
      </div>
      <div className="plan-stack">
        {plans.map((plan) => {
          const weekSessions = sessions.filter(
            (session) =>
              session.planId === plan.id &&
              isInWeek(session.workoutDate, weekStart),
          );
          const completedDays = new Set(
            weekSessions.map((session) => session.dayId),
          );
          return (
            <article
              className={plan.isActive ? "plan-card active" : "plan-card"}
              key={plan.id}
            >
              <div className="plan-head">
                <div>
                  <div className="plan-status">
                    {plan.isActive ? (
                      <>
                        <span /> ACTIVE PLAN
                      </>
                    ) : (
                      "SAVED PLAN"
                    )}
                  </div>
                  <h2>{plan.name}</h2>
                  <p>
                    {completedDays.size}/{plan.days.length} complete this week ·{" "}
                    {plan.days.reduce(
                      (sum, day) => sum + day.exercises.length,
                      0,
                    )}{" "}
                    movements
                  </p>
                </div>
                {!plan.isActive && (
                  <button
                    className="secondary-button"
                    onClick={() => onActivate(plan.id)}
                  >
                    Make active
                  </button>
                )}
              </div>
              <div
                className="week-progress"
                aria-label={`${completedDays.size} of ${plan.days.length} workouts complete`}
              >
                <i
                  style={{
                    width: `${plan.days.length ? (completedDays.size / plan.days.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <div className="schedule-grid">
                {plan.days.map((day) => {
                  const session = weekSessions.find(
                    (item) => item.dayId === day.id,
                  );
                  return (
                    <button
                      className={
                        session ? "day-card completed" : "day-card incomplete"
                      }
                      key={day.id}
                      onClick={() =>
                        session ? onOpenSession(session) : onStart(day)
                      }
                      aria-label={
                        session
                          ? `View completed ${day.name} session`
                          : `Start incomplete ${day.name} session`
                      }
                    >
                      <div className="day-card-head">
                        <span className="day-name">
                          {displayDay(day.dayOfWeek).slice(0, 3)}
                        </span>
                        <strong>{day.name}</strong>
                        <span className="week-status">
                          {session ? "✓ Complete" : "Incomplete"}
                        </span>
                      </div>
                      <ul>
                        {day.exercises.slice(0, 6).map((exercise, index) => (
                          <li key={exercise.id}>
                            <b className="superset-code">
                              {setLabel(exercise, index + 1)}
                            </b>
                            {exercise.name}
                            <span>
                              {exercise.plannedSets}×{formatRepRange(exercise)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <span className="day-start">
                        {session
                          ? `View ${dateLabel(session.workoutDate)} session →`
                          : "Start session →"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
        {!plans.length && (
          <EmptyPanel
            title="No plans yet"
            text="Create a weekly schedule and fill each day from the exercise library."
          />
        )}
      </div>
    </div>
  );
}

function ExerciseLibrary({ exercises }: { exercises: Exercise[] }) {
  const [search, setSearch] = useState("");
  const [muscle, setMuscle] = useState("All");
  const muscles = MUSCLE_ORDER.filter(
    (item) =>
      item === "All" || exercises.some((exercise) => exercise.muscle === item),
  );
  const filtered = exercises.filter(
    (exercise) =>
      (muscle === "All" || exercise.muscle === muscle) &&
      exercise.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="page-wrap subpage">
      <div className="page-title-row">
        <div>
          <div className="kicker">
            <span /> MOVEMENT LIBRARY
          </div>
          <h1>Exercises</h1>
          <p>Find the right movement by target muscle and equipment.</p>
        </div>
        <div className="exercise-count">
          {filtered.length}
          <small>movements</small>
        </div>
      </div>
      <div className="library-tools">
        <label className="search-box">
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search exercises"
          />
        </label>
        <div className="filter-chips" aria-label="Filter exercises by muscle">
          {muscles.map((item) => (
            <button
              key={item}
              className={muscle === item ? "active" : ""}
              onClick={() => setMuscle(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="exercise-grid">
        {filtered.map((exercise) => (
          <article className="exercise-card" key={exercise.id}>
            <div className="exercise-card-mark">
              {exercise.muscle.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <span className="muscle-pill">{exercise.muscle}</span>
              <h3>{exercise.name}</h3>
              <p>
                {exercise.equipment} · Goal {formatRepRange(exercise)} reps
              </p>
            </div>
            <RecommendationBadge exercise={exercise} />
          </article>
        ))}
      </div>
    </div>
  );
}

function ProgressView({ data }: { data: DashboardData }) {
  const tracked = data.exercises.filter(
    (exercise) => data.history[String(exercise.id)]?.length,
  );
  const [selectedId, setSelectedId] = useState(
    tracked[0]?.id ?? data.exercises[0]?.id ?? 0,
  );
  const exercise = data.exercises.find((item) => item.id === selectedId);
  const points = data.history[String(selectedId)] ?? [];
  const max = Math.max(...points.map((point) => point.weight), 1);
  const first = points[0]?.weight ?? 0;
  const last = points.at(-1)?.weight ?? 0;
  return (
    <div className="page-wrap subpage">
      <div className="page-title-row">
        <div>
          <div className="kicker">
            <span /> PROGRESS SIGNALS
          </div>
          <h1>Your line</h1>
          <p>See the work compound, one session at a time.</p>
        </div>
        <select
          className="select-control"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          {tracked.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="progress-layout">
        <article className="chart-card">
          <div className="chart-head">
            <div>
              <small>Top working weight</small>
              <h2>{exercise?.name ?? "Exercise"}</h2>
            </div>
            <div className="chart-gain">
              +{Math.max(0, last - first)} lb
              <small>across logged sessions</small>
            </div>
          </div>
          <div
            className="bar-chart"
            aria-label={`${exercise?.name ?? "Exercise"} weight history`}
          >
            {points.map((point, index) => (
              <div className="bar-column" key={`${point.date}-${index}`}>
                <span className="bar-value">{point.weight}</span>
                <div
                  className="bar"
                  style={{
                    height: `${Math.max(15, (point.weight / max) * 100)}%`,
                  }}
                />
                <small>{dateLabel(point.date)}</small>
              </div>
            ))}
            {!points.length && (
              <div className="empty-chart">
                Log this exercise to begin your chart.
              </div>
            )}
          </div>
        </article>
        <div className="insight-stack">
          <article className="insight-card lime">
            <small>NEXT TARGET</small>
            <strong>{formatWeight(exercise?.recommendedWeight)}</strong>
            <span>for {formatRepRange(exercise ?? {})} reps</span>
            <p>{exercise?.reason}</p>
          </article>
          <article className="insight-card">
            <small>TOTAL VOLUME</small>
            <strong>{data.stats.weeklyVolume.toLocaleString()}</strong>
            <span>lb this week</span>
            <div className="mini-rule">
              <i style={{ width: "68%" }} />
            </div>
          </article>
        </div>
      </div>
      <section className="section-block compact">
        <div className="section-heading">
          <div>
            <span className="section-index">02</span>
            <h2>Recent work</h2>
          </div>
        </div>
        <div className="history-table">
          <div className="history-head">
            <span>Date</span>
            <span>Top weight</span>
            <span>Volume</span>
          </div>
          {points
            .slice()
            .reverse()
            .map((point) => (
              <div className="history-row" key={point.date}>
                <strong>{dateLabel(point.date)}</strong>
                <span>{point.weight} lb</span>
                <span>{point.volume.toLocaleString()} lb</span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

function EmptyPanel({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-panel">
      <span>＋</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function PlanBuilder({
  exercises,
  onClose,
  onSaved,
}: {
  exercises: Exercise[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState("My strength plan");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 3, 5]);
  const [activeDay, setActiveDay] = useState(1);
  const [dayExercises, setDayExercises] = useState<
    Record<number, { exerciseId: string; plannedSets: number }[]>
  >({ 1: [], 3: [], 5: [] });
  const [supersetDays, setSupersetDays] = useState<Record<number, boolean>>({
    1: false,
    3: false,
    5: false,
  });
  const [muscle, setMuscle] = useState("All");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const filtered = exercises.filter(
    (exercise) =>
      (muscle === "All" || exercise.muscle === muscle) &&
      exercise.name.toLowerCase().includes(search.toLowerCase()),
  );

  function toggleDay(day: number) {
    if (selectedDays.includes(day)) {
      if (selectedDays.length === 1) return;
      const next = selectedDays.filter((item) => item !== day);
      setSelectedDays(next);
      setActiveDay(next[0]);
    } else {
      const next = [...selectedDays, day].sort((a, b) => a - b);
      setSelectedDays(next);
      setDayExercises((current) => ({ ...current, [day]: current[day] ?? [] }));
      setSupersetDays((current) => ({ ...current, [day]: false }));
      setActiveDay(day);
    }
  }

  function addExercise(exerciseId: string) {
    setDayExercises((current) => {
      const list = current[activeDay] ?? [];
      if (list.some((item) => item.exerciseId === exerciseId)) return current;
      return {
        ...current,
        [activeDay]: [...list, { exerciseId, plannedSets: 3 }],
      };
    });
  }

  function removeExercise(exerciseId: string) {
    setDayExercises((current) => ({
      ...current,
      [activeDay]: (current[activeDay] ?? []).filter(
        (item) => item.exerciseId !== exerciseId,
      ),
    }));
  }

  function changeSets(exerciseId: string, delta: number) {
    setDayExercises((current) => ({
      ...current,
      [activeDay]: (current[activeDay] ?? []).map((item) =>
        item.exerciseId === exerciseId
          ? {
              ...item,
              plannedSets: Math.min(8, Math.max(1, item.plannedSets + delta)),
            }
          : item,
      ),
    }));
  }

  async function save() {
    if (!name.trim() || !selectedDays.some((day) => dayExercises[day]?.length))
      return;
    setSaving(true);
    const response = await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "createPlan",
        name,
        days: selectedDays.map((day, index) => ({
          name: `Workout ${String.fromCharCode(65 + index)}`,
          dayOfWeek: day,
          exercises: (dayExercises[day] ?? []).map((item, position) => ({
            ...item,
            repMin: 8,
            repMax: 12,
            supersetGroup: supersetDays[day]
              ? Math.floor(position / 2) + 1
              : null,
            supersetPosition: supersetDays[day]
              ? position % 2 === 0
                ? "A"
                : "B"
              : null,
            restSeconds: 120,
          })),
        })),
      }),
    });
    setSaving(false);
    if (response.ok) await onSaved();
  }

  const selected = dayExercises[activeDay] ?? [];
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Create workout plan"
    >
      <div className="builder-panel">
        <div className="modal-head">
          <div>
            <span className="kicker">
              <span /> NEW TRAINING SYSTEM
            </span>
            <h2>Create a plan</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="builder-body">
          <div className="builder-column setup-column">
            <label className="field-label">
              Plan name
              <input
                className="text-control"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div>
              <span className="field-title">Training days</span>
              <div className="day-picker">
                {DAYS.slice(1).map((label, index) => {
                  const day = index + 1;
                  return (
                    <button
                      key={label}
                      className={selectedDays.includes(day) ? "active" : ""}
                      onClick={() => toggleDay(day)}
                    >
                      <span>{label.slice(0, 1)}</span>
                      {label.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="workout-tabs">
              {selectedDays.map((day, index) => (
                <button
                  key={day}
                  className={activeDay === day ? "active" : ""}
                  onClick={() => setActiveDay(day)}
                >
                  <small>{displayDay(day)}</small>Workout{" "}
                  {String.fromCharCode(65 + index)}
                </button>
              ))}
            </div>
            <div className="superset-toggle">
              <input
                id={`superset-toggle-${activeDay}`}
                type="checkbox"
                checked={Boolean(supersetDays[activeDay])}
                onChange={(event) =>
                  setSupersetDays((current) => ({
                    ...current,
                    [activeDay]: event.target.checked,
                  }))
                }
              />
              <label htmlFor={`superset-toggle-${activeDay}`}>
                <strong>Pair as supersets</strong>
                <small>Exercises 1+2, 3+4, and so on · 2:00 rest</small>
              </label>
            </div>
            <div className="selected-list">
              <span className="field-title">Selected exercises</span>
              {selected.map((item, index) => {
                const exercise = exercises.find(
                  (candidate) => candidate.id === item.exerciseId,
                );
                if (!exercise) return null;
                const marker = supersetDays[activeDay]
                  ? `${Math.floor(index / 2) + 1}${index % 2 === 0 ? "A" : "B"}`
                  : `0${index + 1}`;
                return (
                  <div className="selected-row" key={item.exerciseId}>
                    <span className="exercise-number">{marker}</span>
                    <div>
                      <strong>{exercise.name}</strong>
                      <small>{exercise.muscle}</small>
                    </div>
                    <div className="stepper">
                      <button onClick={() => changeSets(item.exerciseId, -1)}>
                        −
                      </button>
                      <span>{item.plannedSets} sets</span>
                      <button onClick={() => changeSets(item.exerciseId, 1)}>
                        ＋
                      </button>
                    </div>
                    <button
                      className="remove-button"
                      onClick={() => removeExercise(item.exerciseId)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {!selected.length && (
                <div className="selected-empty">
                  Choose movements from the library →
                </div>
              )}
            </div>
          </div>
          <div className="builder-column library-column">
            <div className="library-column-head">
              <div>
                <span className="field-title">Exercise library</span>
                <small>{filtered.length} movements</small>
              </div>
              <label className="search-box small">
                <span>⌕</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                />
              </label>
            </div>
            <div className="filter-chips compact">
              {[
                "All",
                ...new Set(exercises.map((exercise) => exercise.muscle)),
              ].map((item) => (
                <button
                  key={item}
                  className={muscle === item ? "active" : ""}
                  onClick={() => setMuscle(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="builder-exercise-list">
              {filtered.map((exercise) => {
                const added = selected.some(
                  (item) => item.exerciseId === exercise.id,
                );
                return (
                  <button
                    key={exercise.id}
                    className={added ? "added" : ""}
                    onClick={() =>
                      added
                        ? removeExercise(exercise.id)
                        : addExercise(exercise.id)
                    }
                  >
                    <div className="exercise-card-mark">
                      {exercise.muscle.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <strong>{exercise.name}</strong>
                      <small>
                        {exercise.equipment} · {exercise.muscle}
                      </small>
                    </div>
                    <span>{added ? "✓" : "＋"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <p>
            {selectedDays.length} days ·{" "}
            {Object.values(dayExercises).flat().length} movements
          </p>
          <button
            className="primary-button"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save plan"}
            <span>→</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionHistoryModal({
  session,
  onClose,
}: {
  session: WorkoutSession;
  onClose: () => void;
}) {
  const grouped = new Map<string, { name: string; sets: SessionSet[] }>();
  for (const set of session.sets) {
    const current = grouped.get(set.exerciseId);
    if (current) current.sets.push(set);
    else grouped.set(set.exerciseId, { name: set.exerciseName, sets: [set] });
  }
  const exercises = [...grouped.values()];
  const volume = session.sets.reduce(
    (sum, set) => sum + set.weight * set.reps,
    0,
  );

  return (
    <div
      className="overlay session-history-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${session.dayName} session details`}
    >
      <div className="session-history-panel">
        <header className="modal-head session-history-head">
          <div>
            <span className="kicker">
              <span /> COMPLETED SESSION
            </span>
            <h2>{session.dayName}</h2>
            <p>
              {fullDateLabel(session.workoutDate)} · {session.planName}
            </p>
          </div>
          <button
            className="close-button"
            onClick={onClose}
            aria-label="Close session details"
          >
            ×
          </button>
        </header>
        <div className="session-history-body">
          <div className="session-summary" aria-label="Session summary">
            <div>
              <small>Exercises</small>
              <strong>{exercises.length}</strong>
            </div>
            <div>
              <small>Working sets</small>
              <strong>{session.sets.length}</strong>
            </div>
            <div>
              <small>Total volume</small>
              <strong>
                {volume.toLocaleString()}
                <span> lb</span>
              </strong>
            </div>
          </div>
          <div className="session-exercise-list">
            {exercises.map((exercise, exerciseIndex) => (
              <section
                className="session-exercise"
                key={`${exercise.name}-${exerciseIndex}`}
              >
                <div className="session-exercise-head">
                  <span>{String(exerciseIndex + 1).padStart(2, "0")}</span>
                  <h3>{exercise.name}</h3>
                  <small>{exercise.sets.length} sets</small>
                </div>
                <div className="session-set-list">
                  {exercise.sets.map((set) => (
                    <div className="session-set" key={set.setNumber}>
                      <span>Set {set.setNumber}</span>
                      <strong>{set.weight} lb</strong>
                      <b>×</b>
                      <strong>{set.reps} reps</strong>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
        <footer className="modal-foot session-history-foot">
          <p>
            This session stays in your history after the weekly status resets.
          </p>
          <button className="primary-button" onClick={onClose}>
            Done<span>✓</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

function PreviousSet({
  item,
  setNumber,
}: {
  item: Exercise;
  setNumber: number;
}) {
  const previous = item.lastSets?.find((set) => set.setNumber === setNumber);
  return (
    <span className="last-set">
      <small>Last time</small>
      <strong>
        {previous
          ? `${previous.weight} lb × ${previous.reps} reps`
          : "No matching set"}
      </strong>
    </span>
  );
}

function WorkoutLogger({
  workout,
  exercises,
  onChange,
  onPause,
  onFinished,
}: {
  workout: ActiveWorkout;
  exercises: Exercise[];
  onChange: (workout: ActiveWorkout) => void;
  onPause: (workout: ActiveWorkout) => Promise<void>;
  onFinished: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState("");
  const [activeGroupIndex, setActiveGroupIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restDuration, setRestDuration] = useState(120);
  const [swapTargetIndex, setSwapTargetIndex] = useState<number | null>(null);
  const [swapQuery, setSwapQuery] = useState("");
  const [pendingReplacement, setPendingReplacement] = useState<Exercise | null>(
    null,
  );
  const [swapNotice, setSwapNotice] = useState("");
  const committedSets = useRef(new Set<string>());
  const swapSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!swapNotice) return;
    const timer = window.setTimeout(() => setSwapNotice(""), 3200);
    return () => window.clearTimeout(timer);
  }, [swapNotice]);

  useEffect(() => {
    if (swapTargetIndex == null) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSwap();
    }
    document.addEventListener("keydown", handleKeyDown);
    if (!pendingReplacement)
      window.requestAnimationFrame(() => swapSearchRef.current?.focus());
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [swapTargetIndex, pendingReplacement]);

  const groups = useMemo(() => {
    const result: { key: string; label: string; memberIndexes: number[] }[] =
      [];
    workout.exercises.forEach((item, index) => {
      const key = item.supersetGroup
        ? `superset-${item.supersetGroup}`
        : `exercise-${item.id}-${index}`;
      const existing = result.find((group) => group.key === key);
      if (existing) existing.memberIndexes.push(index);
      else
        result.push({
          key,
          label: item.supersetGroup
            ? `Superset ${item.supersetGroup}`
            : item.name,
          memberIndexes: [index],
        });
    });
    return result;
  }, [workout.exercises]);

  const activeGroup = groups[activeGroupIndex] ?? groups[0];
  const activeExercises =
    activeGroup?.memberIndexes.map((index) => ({
      exercise: workout.exercises[index],
      exerciseIndex: index,
    })) ?? [];
  const isSuperset = activeExercises.length > 1;
  const completeSets = workout.exercises
    .flatMap((item) => item.sets)
    .filter((set) => set.reps !== "" && set.weight !== "").length;
  const totalSets = workout.exercises.reduce(
    (sum, item) => sum + item.sets.length,
    0,
  );
  const elapsedSeconds =
    workout.elapsedBeforePause +
    Math.max(0, Math.floor((now - workout.resumedAt) / 1000));
  const restSecondsLeft = restEndsAt
    ? Math.max(0, Math.ceil((restEndsAt - now) / 1000))
    : restDuration;
  const restState = restEndsAt
    ? restSecondsLeft > 0
      ? "active"
      : "done"
    : "idle";
  const swapTarget =
    swapTargetIndex == null
      ? null
      : (workout.exercises[swapTargetIndex] ?? null);
  const normalizedSwapQuery = swapQuery.trim().toLowerCase();
  const usedExerciseIds = new Set(
    workout.exercises
      .filter((_, index) => index !== swapTargetIndex)
      .map((exercise) => exercise.id),
  );
  const swapOptions = swapTarget
    ? exercises
        .filter(
          (exercise) =>
            exercise.id !== swapTarget.id && !usedExerciseIds.has(exercise.id),
        )
        .filter(
          (exercise) =>
            !normalizedSwapQuery ||
            `${exercise.name} ${exercise.muscle} ${exercise.equipment}`
              .toLowerCase()
              .includes(normalizedSwapQuery),
        )
        .sort(
          (left, right) =>
            Number(right.muscle === swapTarget.muscle) -
              Number(left.muscle === swapTarget.muscle) ||
            left.name.localeCompare(right.name),
        )
    : [];

  function startRest(seconds = 120) {
    const duration = Math.max(1, seconds || 120);
    setRestDuration(duration);
    setRestEndsAt(now + duration * 1000);
  }

  function updateSet(
    exerciseIndex: number,
    setIndex: number,
    key: "reps" | "weight",
    raw: string,
  ) {
    const value = raw === "" ? "" : Math.max(0, Number(raw));
    const set = workout.exercises[exerciseIndex]?.sets[setIndex];
    if (!set) return;
    const nextSet = { ...set, [key]: value };
    if (nextSet.reps === "" || nextSet.weight === "")
      committedSets.current.delete(
        `${workout.exercises[exerciseIndex].id}:${set.setNumber}`,
      );
    onChange({
      ...workout,
      exercises: workout.exercises.map((item, index) =>
        index === exerciseIndex
          ? {
              ...item,
              sets: item.sets.map((currentSet, current) =>
                current === setIndex ? nextSet : currentSet,
              ),
            }
          : item,
      ),
    });
  }

  function commitSet(exerciseIndex: number, setIndex: number) {
    const item = workout.exercises[exerciseIndex];
    const set = item?.sets[setIndex];
    if (!item || !set || set.reps === "" || set.weight === "") return;
    const key = `${item.id}:${set.setNumber}`;
    if (committedSets.current.has(key)) return;
    committedSets.current.add(key);

    const group = groups.find((candidate) =>
      candidate.memberIndexes.includes(exerciseIndex),
    );
    const roundMembers = group?.memberIndexes.filter((index) =>
      workout.exercises[index].sets.some(
        (candidate) => candidate.setNumber === set.setNumber,
      ),
    ) ?? [exerciseIndex];
    const roundComplete = roundMembers.every((index) => {
      const roundSet = workout.exercises[index].sets.find(
        (candidate) => candidate.setNumber === set.setNumber,
      );
      return roundSet && roundSet.reps !== "" && roundSet.weight !== "";
    });
    if (roundComplete) startRest(item.restSeconds || 120);
  }

  function addRound() {
    if (!activeGroup) return;
    onChange({
      ...workout,
      exercises: workout.exercises.map((item, index) =>
        activeGroup.memberIndexes.includes(index)
          ? {
              ...item,
              sets: [
                ...item.sets,
                { setNumber: item.sets.length + 1, reps: "", weight: "" },
              ],
            }
          : item,
      ),
    });
  }

  function openSwap(exerciseIndex: number) {
    setSwapTargetIndex(exerciseIndex);
    setSwapQuery("");
    setPendingReplacement(null);
  }

  function closeSwap() {
    setSwapTargetIndex(null);
    setSwapQuery("");
    setPendingReplacement(null);
  }

  function replaceExercise(replacement: Exercise) {
    if (swapTargetIndex == null) return;
    const current = workout.exercises[swapTargetIndex];
    if (!current) return;
    const loggedSetCount = current.sets.filter((set) => set.reps !== "").length;
    if (loggedSetCount && pendingReplacement?.id !== replacement.id) {
      setPendingReplacement(replacement);
      return;
    }

    for (const set of current.sets) {
      committedSets.current.delete(`${current.id}:${set.setNumber}`);
      committedSets.current.delete(`${replacement.id}:${set.setNumber}`);
    }
    const nextExercise: ActiveExercise = {
      ...current,
      ...replacement,
      plannedSets: current.plannedSets,
      position: current.position,
      repMin: replacement.repMin ?? current.repMin,
      repMax: replacement.repMax ?? current.repMax,
      perSide: replacement.perSide ?? current.perSide,
      supersetGroup: current.supersetGroup,
      supersetPosition: current.supersetPosition,
      restSeconds: current.restSeconds,
      swappedFrom: current.swappedFrom ?? {
        id: current.id,
        name: current.name,
      },
      sets: current.sets.map((set) => ({ ...set, reps: "", weight: "" })),
    };
    onChange({
      ...workout,
      exercises: workout.exercises.map((item, index) =>
        index === swapTargetIndex ? nextExercise : item,
      ),
    });
    setSwapNotice(`${current.name} swapped for ${replacement.name}`);
    closeSwap();
  }

  function setInput(
    item: ActiveExercise,
    exerciseIndex: number,
    set: SetEntry,
    setIndex: number,
    field: "weight" | "reps",
  ) {
    const previous = item.lastSets?.find(
      (entry) => entry.setNumber === set.setNumber,
    );
    const baseline = previous?.weight ?? item.lastWeight;
    const target = item.recommendedWeight;
    const delta = baseline != null && target != null ? target - baseline : null;
    const direction =
      delta != null && delta > 0
        ? "increase"
        : delta != null && delta < 0
          ? "decrease"
          : "hold";
    const guidanceId = `guidance-${item.id}-${set.setNumber}`;
    const input = (
      <input
        inputMode={field === "weight" ? "decimal" : "numeric"}
        aria-label={`${item.name}, set ${set.setNumber}, ${field}`}
        value={set[field]}
        placeholder={previous ? String(previous[field]) : "—"}
        aria-describedby={field === "weight" ? guidanceId : undefined}
        onChange={(event) =>
          updateSet(exerciseIndex, setIndex, field, event.target.value)
        }
        onBlur={() => commitSet(exerciseIndex, setIndex)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    );
    if (field === "reps") return input;
    return (
      <span className={`set-weight-field ${direction}`}>
        <span className="set-weight-input">
          {input}
          {delta != null && (
            <span className="weight-direction" aria-hidden="true">
              {delta > 0 ? "↑" : delta < 0 ? "↓" : "—"}
            </span>
          )}
        </span>
        <span className="set-weight-hint" id={guidanceId}>
          {delta == null ? (
            "Choose a weight"
          ) : (
            <>
              {delta > 0
                ? `Add ${delta} lb`
                : delta < 0
                  ? `Lower ${Math.abs(delta)} lb`
                  : "Same weight"}
              <span>Try {target} lb</span>
            </>
          )}
        </span>
      </span>
    );
  }

  async function pause() {
    setPausing(true);
    setPauseError("");
    try {
      await onPause(pausedSnapshot(workout));
    } catch (cause) {
      setPauseError(
        cause instanceof Error ? cause.message : "Could not pause the workout.",
      );
      setPausing(false);
    }
  }

  async function finish() {
    const sets = workout.exercises.flatMap((item) =>
      item.sets
        .filter((set) => set.reps !== "" && set.weight !== "")
        .map((set) => ({
          exerciseId: item.id,
          setNumber: set.setNumber,
          reps: Number(set.reps),
          weight: Number(set.weight),
        })),
    );
    if (!sets.length) return;
    setSaving(true);
    const durationSeconds = Math.max(1, elapsedSeconds);
    const response = await fetch("/api/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "logWorkout",
        workout,
        planId: workout.planId,
        dayId: workout.dayId,
        workoutDate: workout.workoutDate,
        durationSeconds,
        sets,
      }),
    });
    setSaving(false);
    if (response.ok) await onFinished();
  }

  if (!activeGroup || !activeExercises.length) return null;
  const roundCount = Math.max(
    ...activeExercises.map(({ exercise }) => exercise.sets.length),
  );
  const groupRest = activeExercises[0]?.exercise.restSeconds || 120;
  return (
    <div
      className="overlay logger-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Log ${workout.dayName}`}
    >
      <div className="logger-panel">
        <header className="logger-head">
          <div className="logger-title">
            <span className="kicker">
              <span /> LIVE SESSION
            </span>
            <h2>{workout.dayName}</h2>
          </div>
          <div className="session-timers">
            <div className="workout-timer">
              <small>Workout</small>
              <strong>{formatElapsed(elapsedSeconds)}</strong>
            </div>
            <div className={`rest-timer ${restState}`} aria-live="polite">
              <small>
                {restState === "idle"
                  ? "Rest · default"
                  : restState === "done"
                    ? "Rest complete"
                    : "Resting"}
              </small>
              <strong>{formatElapsed(restSecondsLeft)}</strong>
              {restEndsAt ? (
                <div>
                  <button onClick={() => setRestEndsAt(null)}>Skip</button>
                  <button
                    onClick={() =>
                      setRestEndsAt(
                        (current) => (current ?? Date.now()) + 30000,
                      )
                    }
                  >
                    +30s
                  </button>
                </div>
              ) : null}
            </div>
            <div className="logger-progress">
              <span>
                {completeSets}/{totalSets} sets
              </span>
              <i>
                <b
                  style={{
                    width: `${totalSets ? (completeSets / totalSets) * 100 : 0}%`,
                  }}
                />
              </i>
            </div>
          </div>
          <button
            className="close-button pause-close"
            disabled={saving || pausing}
            onClick={() => void pause()}
            aria-label="Pause workout"
          >
            Ⅱ
          </button>
        </header>
        <div className="logger-main">
          <aside className="logger-exercises">
            {groups.map((group, index) => {
              const members = group.memberIndexes.map(
                (memberIndex) => workout.exercises[memberIndex],
              );
              const done = members.every((item) =>
                item.sets.every((set) => set.reps !== "" && set.weight !== ""),
              );
              return (
                <div className="logger-exercise-cluster" key={group.key}>
                  <button
                    className={activeGroupIndex === index ? "active" : ""}
                    onClick={() => setActiveGroupIndex(index)}
                  >
                    <span>
                      {done
                        ? "✓"
                        : members.length > 1
                          ? `${members[0].supersetGroup}A/B`
                          : setLabel(members[0], index + 1)}
                    </span>
                    <div>
                      <small>
                        {members.length > 1
                          ? `${group.label} · ${formatRest(members[0].restSeconds)} rest`
                          : `${members[0].sets.length} sets · ${formatRepRange(members[0])}`}
                      </small>
                      <strong>
                        {members.map((item) => item.name).join(" + ")}
                      </strong>
                    </div>
                  </button>
                </div>
              );
            })}
          </aside>
          <section className="set-logger">
            <div className="set-logger-head">
              <div className="set-logger-context">
                <span className="muscle-pill">
                  {isSuperset ? "SUPERSET" : activeExercises[0].exercise.muscle}
                </span>
                <h3>
                  {activeExercises
                    .map(({ exercise }) => exercise.name)
                    .join(" + ")}
                </h3>
                <p>
                  {isSuperset
                    ? `Move through A, then B · ${formatRest(groupRest)} rest starts after each round`
                    : `${activeExercises[0].exercise.equipment} · Goal range ${formatRepRange(activeExercises[0].exercise)}`}
                </p>
                {activeExercises.some(
                  ({ exercise }) => exercise.swappedFrom,
                ) ? (
                  <small className="swap-origin">
                    Session swap ·{" "}
                    {activeExercises
                      .filter(({ exercise }) => exercise.swappedFrom)
                      .map(
                        ({ exercise }) =>
                          `${exercise.swappedFrom?.name} → ${exercise.name}`,
                      )
                      .join(" · ")}
                  </small>
                ) : null}
              </div>
              <div className="set-logger-tools">
                <div className="swap-actions">
                  {activeExercises.map(({ exercise, exerciseIndex }) => (
                    <button
                      key={exercise.id}
                      className="swap-trigger"
                      onClick={() => openSwap(exerciseIndex)}
                      aria-label={`Swap ${exercise.name}`}
                    >
                      <span aria-hidden="true">⇄</span>
                      {isSuperset ? exercise.name : "Swap exercise"}
                    </button>
                  ))}
                </div>
                <span className="auto-rest-note">
                  <b>↻ {formatRest(groupRest)}</b> Enter both fields, then tap
                  away to start rest.
                </span>
              </div>
            </div>
            {swapNotice ? (
              <div className="swap-notice" role="status">
                <span>✓</span>
                {swapNotice}
                <small>Your plan is unchanged.</small>
              </div>
            ) : null}

            {isSuperset ? (
              <div className="superset-rounds">
                {Array.from({ length: roundCount }, (_, roundIndex) => (
                  <section className="superset-round" key={roundIndex}>
                    <div className="round-heading">
                      <span>Round {roundIndex + 1}</span>
                      <small>A → B → rest</small>
                    </div>
                    {activeExercises.map(
                      ({ exercise: item, exerciseIndex }, memberIndex) => {
                        const setIndex = item.sets.findIndex(
                          (set) => set.setNumber === roundIndex + 1,
                        );
                        const set = item.sets[setIndex];
                        if (!set) return null;
                        const inRange =
                          set.reps !== "" &&
                          Number(set.reps) >= item.repMin &&
                          Number(set.reps) <= item.repMax;
                        return (
                          <div className="interleaved-set" key={item.id}>
                            <div className="movement-label">
                              <b>{String.fromCharCode(65 + memberIndex)}</b>
                              <span>
                                <strong>{item.name}</strong>
                                <small>
                                  {item.equipment} · target{" "}
                                  {formatRepRange(item)}
                                </small>
                                <PreviousSet
                                  item={item}
                                  setNumber={set.setNumber}
                                />
                              </span>
                            </div>
                            <label>
                              <span>
                                Weight <small>lb</small>
                              </span>
                              {setInput(
                                item,
                                exerciseIndex,
                                set,
                                setIndex,
                                "weight",
                              )}
                            </label>
                            <label>
                              <span>Reps</span>
                              {setInput(
                                item,
                                exerciseIndex,
                                set,
                                setIndex,
                                "reps",
                              )}
                            </label>
                            <span
                              className={
                                set.reps === ""
                                  ? "set-status"
                                  : inRange
                                    ? "set-status hit"
                                    : "set-status miss"
                              }
                            >
                              {set.reps === ""
                                ? "Open"
                                : inRange
                                  ? "In range"
                                  : "Adjust"}
                            </span>
                          </div>
                        );
                      },
                    )}
                  </section>
                ))}
              </div>
            ) : (
              <div className="single-set-list">
                {activeExercises[0].exercise.sets.map((set, setIndex) => {
                  const item = activeExercises[0].exercise;
                  const exerciseIndex = activeExercises[0].exerciseIndex;
                  const inRange =
                    set.reps !== "" &&
                    Number(set.reps) >= item.repMin &&
                    Number(set.reps) <= item.repMax;
                  return (
                    <div className="single-set-card" key={set.setNumber}>
                      <div className="set-number">
                        <small>Set</small>
                        <strong>{set.setNumber}</strong>
                      </div>
                      <div className="previous-cell">
                        <PreviousSet item={item} setNumber={set.setNumber} />
                      </div>
                      <label>
                        <span>
                          Weight <small>lb</small>
                        </span>
                        {setInput(item, exerciseIndex, set, setIndex, "weight")}
                      </label>
                      <label>
                        <span>Reps</span>
                        {setInput(item, exerciseIndex, set, setIndex, "reps")}
                      </label>
                      <span
                        className={
                          set.reps === ""
                            ? "set-status"
                            : inRange
                              ? "set-status hit"
                              : "set-status miss"
                        }
                      >
                        {set.reps === ""
                          ? "Open"
                          : inRange
                            ? "In range"
                            : "Adjust"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <button className="add-set-button" onClick={addRound}>
              ＋ Add {isSuperset ? "a round" : "a set"}
            </button>
          </section>
        </div>
        <footer className="modal-foot logger-foot">
          <p className={pauseError ? "logger-save-error" : ""}>
            {pauseError ||
              (completeSets === totalSets
                ? "All planned sets logged. Nice work."
                : `${totalSets - completeSets} sets left on the line.`)}
          </p>
          <div className="logger-footer-actions">
            <button
              className="pause-workout-button"
              disabled={saving || pausing}
              onClick={() => void pause()}
            >
              {pausing ? "Pausing…" : "Pause workout"}
              <span>Ⅱ</span>
            </button>
            <button
              className="primary-button"
              disabled={!completeSets || saving || pausing}
              onClick={() => void finish()}
            >
              {saving ? "Saving…" : "Finish workout"}
              <span>✓</span>
            </button>
          </div>
        </footer>
      </div>
      {swapTarget ? (
        <div className="swap-overlay">
          <section
            className="swap-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-title"
          >
            <header className="swap-head">
              <div>
                <span className="kicker">
                  <span /> SESSION-ONLY CHANGE
                </span>
                <h2 id="swap-title">Swap {swapTarget.name}</h2>
                <p>Keep this workout moving without editing your plan.</p>
              </div>
              <button
                className="close-button"
                onClick={closeSwap}
                aria-label="Close exercise swap"
              >
                ×
              </button>
            </header>
            {pendingReplacement ? (
              <div className="swap-confirm">
                <span className="swap-glyph" aria-hidden="true">
                  ⇄
                </span>
                <p>
                  Replace <strong>{swapTarget.name}</strong> with
                </p>
                <h3>{pendingReplacement.name}</h3>
                <div className="swap-warning">
                  <strong>
                    {swapTarget.sets.filter((set) => set.reps !== "").length}{" "}
                    entered{" "}
                    {swapTarget.sets.filter((set) => set.reps !== "").length ===
                    1
                      ? "set"
                      : "sets"}{" "}
                    will be cleared.
                  </strong>
                  <span>The replacement starts with fresh set entries.</span>
                </div>
                <div className="swap-confirm-actions">
                  <button
                    className="text-button"
                    onClick={() => setPendingReplacement(null)}
                  >
                    Keep {swapTarget.name}
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => replaceExercise(pendingReplacement)}
                  >
                    Swap & clear<span>→</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="swap-current">
                  <span className="exercise-card-mark">
                    {swapTarget.muscle.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <small>Replacing</small>
                    <strong>{swapTarget.name}</strong>
                    <p>
                      {swapTarget.plannedSets} sets ·{" "}
                      {formatRepRange(swapTarget)} reps ·{" "}
                      {formatRest(swapTarget.restSeconds)} rest
                    </p>
                  </div>
                </div>
                <div className="swap-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    ref={swapSearchRef}
                    value={swapQuery}
                    onChange={(event) => setSwapQuery(event.target.value)}
                    placeholder="Search exercises, muscles, or equipment"
                    aria-label="Search replacement exercises"
                  />
                </div>
                <div className="swap-list" aria-label="Replacement exercises">
                  {swapOptions.map((exercise) => (
                    <button
                      key={exercise.id}
                      onClick={() => replaceExercise(exercise)}
                    >
                      <span className="exercise-card-mark">
                        {exercise.muscle.slice(0, 2).toUpperCase()}
                      </span>
                      <span>
                        <strong>{exercise.name}</strong>
                        <small>
                          {exercise.equipment} · {exercise.muscle} ·{" "}
                          {formatRepRange(exercise)} reps
                        </small>
                      </span>
                      <span className="swap-option-meta">
                        {exercise.muscle === swapTarget.muscle ? (
                          <b>Same muscle</b>
                        ) : null}
                        <small>
                          {exercise.lastWeight == null
                            ? "No history"
                            : `Last ${formatWeight(exercise.lastWeight)}`}
                        </small>
                      </span>
                      <i aria-hidden="true">→</i>
                    </button>
                  ))}
                </div>
                {!swapOptions.length ? (
                  <div className="swap-empty">
                    <strong>No matches</strong>
                    <p>Try another exercise, muscle, or equipment name.</p>
                  </div>
                ) : null}
                <footer className="swap-foot">
                  <span>⇄</span>
                  <p>
                    <strong>This workout only.</strong> Your programmed exercise
                    stays in the plan for next time.
                  </p>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
