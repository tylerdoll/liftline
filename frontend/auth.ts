export type RuntimeConfig = {
  clientId: string;
  cognitoDomain: string;
  issuer: string;
  redirectUri: string;
  scope: string;
};
let config: RuntimeConfig;
let token: string | undefined;
let expires = 0;
let userId: string | undefined;
const base64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function configure() {
  const r = await fetch("/runtime-config.json", { cache: "no-store" });
  if (!r.ok) throw new Error("Application configuration unavailable");
  config = await r.json();
  return config;
}
export async function signIn() {
  if (location.hash.startsWith("#share="))
    sessionStorage.setItem("liftline-pending-share", location.hash);
  const verifier = base64(crypto.getRandomValues(new Uint8Array(32))),
    state = crypto.randomUUID();
  sessionStorage.setItem(
    "liftline-pkce",
    JSON.stringify({ verifier, state, createdAt: Date.now() }),
  );
  const challenge = base64(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  location.assign(
    `${config.cognitoDomain}/oauth2/authorize?${new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, scope: config.scope, state, code_challenge: challenge, code_challenge_method: "S256" })}`,
  );
}
export async function callback() {
  const params = new URLSearchParams(location.search);
  if (!params.has("code")) return false;
  const saved = JSON.parse(sessionStorage.getItem("liftline-pkce") ?? "null");
  sessionStorage.removeItem("liftline-pkce");
  history.replaceState(null, "", location.pathname + location.hash);
  if (
    !saved ||
    saved.state !== params.get("state") ||
    Date.now() - saved.createdAt > 600000
  )
    throw new Error("Sign-in expired; try again");
  const r = await fetch(`${config.cognitoDomain}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code: params.get("code")!,
      redirect_uri: config.redirectUri,
      code_verifier: saved.verifier,
    }),
  });
  if (!r.ok) throw new Error("Sign-in failed");
  const v = await r.json();
  token = v.access_token;
  expires = Date.now() + v.expires_in * 1000;
  const share = sessionStorage.getItem("liftline-pending-share");
  if (share) {
    history.replaceState(null, "", location.pathname + share);
    sessionStorage.removeItem("liftline-pending-share");
  }
  return true;
}
export function signOut() {
  token = undefined;
  userId = undefined;
  expires = 0;
  location.assign(
    `${config.cognitoDomain}/logout?${new URLSearchParams({ client_id: config.clientId, logout_uri: config.redirectUri })}`,
  );
}
export function currentUser() {
  return userId;
}
export function bindUser(id: string) {
  userId = id;
}
export async function api(path: string, method = "GET", value?: unknown) {
  if (!token || Date.now() >= expires)
    throw Object.assign(
      new Error("Sign in again to sync your saved local edits"),
      { status: 401 },
    );
  const r = await fetch(`/api/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: value === undefined ? undefined : JSON.stringify(value),
    cache: "no-store",
  });
  const body = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(body.error ?? "Request failed"), {
      status: r.status,
    });
  return body;
}
