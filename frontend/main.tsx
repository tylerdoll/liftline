import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "./page";
import {
  api,
  bindUser,
  callback,
  configure,
  currentUser,
  signIn,
  signOut,
} from "./auth";
import { all, outbox, recovery, setTimezone, today } from "./bridge";
import type { Entry } from "./outbox";
import "./globals.css";
const mutation = (value: unknown, expectedRevision = 0) => ({
  operationId: crypto.randomUUID(),
  expectedRevision,
  value,
});
function App() {
  const [me, setMe] = useState<any>(),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [state, setState] = useState(""),
    [pending, setPending] = useState<Entry[]>([]),
    [version, setVersion] = useState(0),
    [zone, setZone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [tools, setTools] = useState(false),
    [plans, setPlans] = useState<any[]>([]),
    [sessions, setSessions] = useState<any[]>([]),
    [shares, setShares] = useState<any[]>([]),
    [link, setLink] = useState("");
  const refresh = async () => {
    setPending(await recovery.forUser(currentUser()!));
    setVersion((v) => v + 1);
  };
  useEffect(() => {
    void configure()
      .then(callback)
      .then(async (signed) => {
        if (signed) {
          const p = await api("me");
          bindUser(p.id);
          setMe(p);
          setTimezone(p.timezone ?? zone);
          setPending(await recovery.forUser(p.id));
        }
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
    const listener = (e: Event) => setState((e as CustomEvent).detail);
    window.addEventListener("save-status", listener);
    return () => window.removeEventListener("save-status", listener);
  }, []);
  async function attempt(fn: () => Promise<void>) {
    try {
      setError("");
      await fn();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function share(kind: string, id: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    await api(
      "shares",
      "POST",
      mutation({ id: crypto.randomUUID(), kind, sourceId: id, token }),
    );
    setLink(`${location.origin}/#share=${token}`);
    setShares(await all("shares"));
  }
  if (!ready)
    return (
      <main className="page-wrap">
        <h1>Liftline</h1>
        <p>Loading…</p>
      </main>
    );
  if (!me)
    return (
      <main className="page-wrap">
        <h1>Liftline</h1>
        <p>Your private training log.</p>
        {error && <p role="alert">{error}</p>}
        <button className="primary-button" onClick={() => void attempt(signIn)}>
          Sign in
        </button>
      </main>
    );
  if (!me.timezone)
    return (
      <main className="page-wrap">
        <h1>Confirm your timezone</h1>
        <p>
          Paused sessions close at midnight in this timezone, including daylight
          saving changes.
        </p>
        <input
          aria-label="IANA timezone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        />
        <button
          onClick={() =>
            void attempt(async () => {
              const p = await api(
                "me",
                "PUT",
                mutation({ timezone: zone, activePlanId: null }, me.revision),
              );
              setMe(p);
              setTimezone(p.timezone);
            })
          }
        >
          Confirm timezone
        </button>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <>
      <div className="account-controls">
        <span role="status">{state}</span>
        <button
          onClick={() =>
            void attempt(async () => {
              setTools(!tools);
              setPlans(await all("plans"));
              setSessions(await all("sessions"));
              setShares(await all("shares"));
              setPending(await recovery.forUser(me.id));
            })
          }
        >
          Account, sharing & recovery
        </button>
        <button onClick={signOut}>Sign out</button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button onClick={() => void attempt(signIn)}>Sign in again</button>
        </div>
      )}
      {new URLSearchParams(location.hash.slice(1)).has("share") && (
        <aside className="error-banner">
          Copy this shared plan or workout template into your account?
          <button
            onClick={() =>
              void attempt(async () => {
                await api("shares/redeem", "POST", {
                  token: new URLSearchParams(location.hash.slice(1)).get(
                    "share",
                  ),
                });
                history.replaceState(null, "", location.pathname);
                await refresh();
              })
            }
          >
            Copy template
          </button>
        </aside>
      )}
      {pending.length > 0 && (
        <aside className="error-banner">
          {pending.length} local draft(s) need recovery. Open account tools to
          review and sync them.
        </aside>
      )}
      {tools && (
        <section className="page-wrap">
          <h2>Account tools</h2>
          <p>
            Timezone: {me.timezone}. Shared copies never count as completed
            workouts.
          </p>
          <h3>Local recovery</h3>
          {pending.map((e) => (
            <div key={e.key}>
              <strong>
                {e.latest.dayName} · {e.latest.workoutDate}
              </strong>
              <button
                onClick={() =>
                  void attempt(async () => {
                    await outbox.flush(e.key);
                    await refresh();
                  })
                }
              >
                Retry sync
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(e, null, 2)], {
                      type: "application/json",
                    }),
                    url = URL.createObjectURL(blob),
                    a = document.createElement("a");
                  a.href = url;
                  a.download = "liftline-local-recovery.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download local copy
              </button>
              <button
                onClick={() =>
                  void attempt(async () => {
                    if (
                      !confirm(
                        "Create a new draft today from these local edits? The old session stays unchanged. Review the sets before completing.",
                      )
                    )
                      return;
                    const now = Date.now(),
                      v = {
                        ...e.latest,
                        id: crypto.randomUUID(),
                        workoutDate: today(),
                        startedAt: now,
                        resumedAt: now,
                      };
                    await outbox.enqueue(me.id, v);
                    await outbox.flush(`${me.id}/${v.id}`);
                    await recovery.delete(e.key);
                    await refresh();
                  })
                }
              >
                Recover as a new draft
              </button>
            </div>
          ))}
          <h3>Custom exercise</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                values = new FormData(form);
              void attempt(async () => {
                const id = crypto.randomUUID();
                await api(
                  `exercises/${id}`,
                  "PUT",
                  mutation({
                    id,
                    name: values.get("name"),
                    muscle: values.get("muscle"),
                    equipment: values.get("equipment"),
                  }),
                );
                form.reset();
                await refresh();
              });
            }}
          >
            <input name="name" aria-label="Exercise name" required />
            <input name="muscle" aria-label="Muscle" required />
            <input name="equipment" aria-label="Equipment" required />
            <button>Add private exercise</button>
          </form>
          <h3>Share a copy for 7 days</h3>
          {plans.map((p) => (
            <div key={p.id}>
              {p.name}
              <button onClick={() => void attempt(() => share("PLAN", p.id))}>
                Share plan
              </button>
            </div>
          ))}
          {sessions
            .filter((s) => s.status === "completed")
            .map((s) => (
              <div key={s.id}>
                {s.dayName} · {s.workoutDate}
                <button
                  onClick={() => void attempt(() => share("SESSION", s.id))}
                >
                  Share workout template
                </button>
              </div>
            ))}
          {link && (
            <label>
              Private link
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
          )}
          <h3>Existing links</h3>
          {shares.map((s) => (
            <div key={s.id}>
              Expires {new Date(s.expiresAt).toLocaleString()} ·{" "}
              {s.revoked ? "Revoked" : "Active"}
              {!s.revoked && (
                <button
                  onClick={() =>
                    void attempt(async () => {
                      await api(
                        `shares/${s.id}/revoke`,
                        "POST",
                        mutation(null, s.revision),
                      );
                      setShares(await all("shares"));
                    })
                  }
                >
                  Revoke link
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      <Home refreshSignal={version} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
