import { ThemeProvider, CssBaseline } from "@mui/material";
import { theme } from "./theme";
import "@fontsource/roboto/latin-300.css";
import "@fontsource/roboto/latin-400.css";
import "@fontsource/roboto/latin-500.css";
import "@fontsource/roboto/latin-700.css";
import { Button, Typography, Alert } from "@mui/material";
import { Field } from "./ui";
import { lazy, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
const Home = lazy(() => import("./page"));
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
        <Typography component="h1" variant="h3" gutterBottom>
          Liftline
        </Typography>
        <Typography component="p" variant="body2" color="text.secondary">
          Loading…
        </Typography>
      </main>
    );
  if (!me)
    return (
      <main className="page-wrap">
        <Typography component="h1" variant="h3" gutterBottom>
          Liftline
        </Typography>
        <Typography component="p" variant="body2" color="text.secondary">
          Your private training log.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <Button
          variant="contained"
          type="button"
          className="primary-button"
          onClick={() => void attempt(signIn)}
        >
          Sign in
        </Button>
      </main>
    );
  if (!me.timezone)
    return (
      <main className="page-wrap">
        <Typography component="h1" variant="h3" gutterBottom>
          Confirm your timezone
        </Typography>
        <Typography component="p" variant="body2" color="text.secondary">
          Paused sessions close at midnight in this timezone, including daylight
          saving changes.
        </Typography>
        <Field
          aria-label="IANA timezone"
          label="IANA timezone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        />
        <Button
          variant="outlined"
          type="button"
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
        </Button>
        {error && <Alert severity="error">{error}</Alert>}
      </main>
    );
  return (
    <>
      <div className="account-controls">
        <span role="status">{state}</span>
        <Button
          variant="outlined"
          type="button"
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
        </Button>
        <Button variant="outlined" type="button" onClick={signOut}>
          Sign out
        </Button>
      </div>
      {error && (
        <Alert severity="error" className="error-banner">
          {error}
          <Button
            variant="outlined"
            type="button"
            onClick={() => void attempt(signIn)}
          >
            Sign in again
          </Button>
        </Alert>
      )}
      {new URLSearchParams(location.hash.slice(1)).has("share") && (
        <Alert severity="info" className="error-banner">
          Copy this shared plan or workout template into your account?
          <Button
            variant="outlined"
            type="button"
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
          </Button>
        </Alert>
      )}
      {pending.length > 0 && (
        <Alert severity="info" className="error-banner">
          {pending.length} local draft(s) need recovery. Open account tools to
          review and sync them.
        </Alert>
      )}
      {tools && (
        <section className="page-wrap account-tools">
          <Typography component="h2" variant="h5" gutterBottom>
            Account tools
          </Typography>
          <Typography component="p" variant="body2" color="text.secondary">
            Timezone: {me.timezone}. Shared copies never count as completed
            workouts.
          </Typography>
          <Typography component="h3" variant="h6" gutterBottom>
            Local recovery
          </Typography>
          {pending.map((e) => (
            <div key={e.key}>
              <strong>
                {e.latest.dayName} · {e.latest.workoutDate}
              </strong>
              <Button
                variant="outlined"
                type="button"
                onClick={() =>
                  void attempt(async () => {
                    await outbox.flush(e.key);
                    await refresh();
                  })
                }
              >
                Retry sync
              </Button>
              <Button
                variant="outlined"
                type="button"
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
              </Button>
              <Button
                variant="outlined"
                type="button"
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
              </Button>
            </div>
          ))}
          <Typography component="h3" variant="h6" gutterBottom>
            Custom exercise
          </Typography>
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
            <Field
              name="name"
              aria-label="Exercise name"
              label="Exercise name"
              required
            />
            <Field name="muscle" aria-label="Muscle" label="Muscle" required />
            <Field
              name="equipment"
              aria-label="Equipment"
              label="Equipment"
              required
            />
            <Button variant="contained" type="submit">
              Add private exercise
            </Button>
          </form>
          <Typography component="h3" variant="h6" gutterBottom>
            Share a copy for 7 days
          </Typography>
          {plans.map((p) => (
            <div key={p.id}>
              {p.name}
              <Button
                variant="outlined"
                type="button"
                onClick={() => void attempt(() => share("PLAN", p.id))}
              >
                Share plan
              </Button>
            </div>
          ))}
          {sessions
            .filter((s) => s.status === "completed")
            .map((s) => (
              <div key={s.id}>
                {s.dayName} · {s.workoutDate}
                <Button
                  variant="outlined"
                  type="button"
                  onClick={() => void attempt(() => share("SESSION", s.id))}
                >
                  Share workout template
                </Button>
              </div>
            ))}
          {link && (
            <label>
              Private link
              <Field readOnly value={link} onFocus={(e) => e.target.select()} />
            </label>
          )}
          <Typography component="h3" variant="h6" gutterBottom>
            Existing links
          </Typography>
          {shares.map((s) => (
            <div key={s.id}>
              Expires {new Date(s.expiresAt).toLocaleString()} ·{" "}
              {s.revoked ? "Revoked" : "Active"}
              {!s.revoked && (
                <Button
                  variant="outlined"
                  type="button"
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
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <Suspense
        fallback={
          <Typography role="status" sx={{ p: 3 }}>
            Loading your training log…
          </Typography>
        }
      >
        <Home refreshSignal={version} />
      </Suspense>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <App />
  </ThemeProvider>,
);
