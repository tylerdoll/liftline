import { api, currentUser } from "./auth";
import { Outbox, RecoveryDB } from "./outbox";
import { session } from "../contracts";
import { presentDashboard } from "./dashboard";
let timezone = "UTC";
const revisions = new Map<string, number>();
export const recovery = new RecoveryDB();
export const outbox = new Outbox(
  recovery,
  currentUser,
  async (id, body) => {
    const r = await api(`sessions/${id}`, "PUT", body);
    revisions.set(id, r.revision);
    return r;
  },
  (state) =>
    window.dispatchEvent(new CustomEvent("save-status", { detail: state })),
);
export function setTimezone(value: string) {
  timezone = value;
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function clean(w: any) {
  return session.parse({
    ...Object.fromEntries(Object.keys(session.shape).map((k) => [k, w[k]])),
    planName: w.planName ?? "Training plan",
    exercises: w.exercises.map((e: any) =>
      Object.fromEntries(
        [
          "id",
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
          "sets",
        ].map((k) => [k, e[k]]),
      ),
    ),
  });
}
export async function scheduleDraft(w: any) {
  await outbox.enqueue(
    currentUser()!,
    clean(w),
    revisions.get(w.id) ?? w.revision ?? 0,
  );
}
export async function saveDraft(w: any) {
  await scheduleDraft(w);
  await outbox.flush(`${currentUser()}/${w.id}`);
  return w.id;
}
export async function all(path: string) {
  let cursor;
  const items = [];
  do {
    const p = await api(
      `${path}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    for (let item of p.items) {
      if (item.legacyOversized && ["plans", "sessions"].includes(path)) {
        const chunks: Uint8Array[] = [];
        let part = 0,
          parts = 1;
        while (part < parts) {
          const r = await api(`${path}/${item.id}/legacy?part=${part}`);
          chunks.push(Uint8Array.from(atob(r.content), (c) => c.charCodeAt(0)));
          parts = r.parts;
          part++;
        }
        const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
        let offset = 0;
        for (const c of chunks) {
          bytes.set(c, offset);
          offset += c.length;
        }
        item = JSON.parse(new TextDecoder().decode(bytes));
      }
      items.push(item);
    }
    cursor = p.cursor;
  } while (cursor);
  return items;
}
export async function dashboard() {
  const [catalog, customs, plans, sessions, weeks, me] = await Promise.all([
    all("catalog"),
    all("exercises"),
    all("plans"),
    all("sessions"),
    all("weeks"),
    api("me"),
  ]);
  setTimezone(me.timezone ?? "UTC");
  for (const s of sessions) revisions.set(s.id, s.revision);
  return presentDashboard(catalog, customs, plans, sessions, weeks, me);
}

const mutation = (value: unknown, expectedRevision = 0) => ({
  operationId: crypto.randomUUID(),
  expectedRevision,
  value,
});
export async function legacyFetch(_url: string, options?: RequestInit) {
  try {
    if (!options?.method || options.method === "GET")
      return Response.json(await dashboard());
    const p = JSON.parse(options.body as string);
    let r;
    if (p.action === "createPlan") {
      const id = crypto.randomUUID();
      r = await api(
        `plans/${id}`,
        "PUT",
        mutation({
          id,
          name: p.name,
          days: p.days.map((d: any, i: number) => ({
            ...d,
            id: crypto.randomUUID(),
            position: i,
            exercises: d.exercises.map((e: any, position: number) => ({
              ...e,
              position,
              perSide: e.perSide ?? false,
            })),
          })),
        }),
      );
    } else if (p.action === "activatePlan") {
      const me = await api("me");
      r = await api(
        "me",
        "PUT",
        mutation(
          { timezone: me.timezone, activePlanId: p.planId },
          me.revision,
        ),
      );
    } else if (p.action === "discardWorkoutDraft") {
      const s = await api(`sessions/${p.draftId}`);
      r = await api(
        `sessions/${p.draftId}/discard`,
        "POST",
        mutation(null, s.revision),
      );
    } else if (p.action === "logWorkout") {
      const key = p.workout.id;
      const receiptKey = `finish/${currentUser()}/${key}`;
      let pending = sessionStorage.getItem(receiptKey);
      if (!pending) {
        await saveDraft(p.workout);
        pending = JSON.stringify(mutation(null, revisions.get(key)!));
        sessionStorage.setItem(receiptKey, pending);
      }
      r = await api(`sessions/${key}/complete`, "POST", JSON.parse(pending));
      sessionStorage.removeItem(receiptKey);
    } else throw new Error("Unknown action");
    return Response.json(r);
  } catch (e: any) {
    window.dispatchEvent(new CustomEvent("save-status", { detail: e.message }));
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
