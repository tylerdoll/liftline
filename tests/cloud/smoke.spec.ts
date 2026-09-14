import { test, expect, type Browser } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
async function login(
  browser: Browser,
  url: string,
  email: string,
  password: string,
) {
  const context = await browser.newContext(),
    page = await context.newPage();
  let token = "";
  page.on("request", (r) => {
    if (r.url().startsWith(`${url}api/v1/`))
      token = r.headers().authorization ?? token;
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByLabel(/email|username/i)
    .first()
    .fill(email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(password);
  await page
    .getByRole("button", { name: /sign in/i })
    .last()
    .click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  if (!token) throw new Error("No authenticated request observed");
  return { context, page, token };
}
test("real managed login, same-origin API, isolation, durable completion and copying", async ({
  browser,
}) => {
  const stage = process.env.STAGE!;
  const out = JSON.parse(
    await readFile(`release/${stage}-outputs.json`, "utf8"),
  );
  const url = out.Url;
  const env = (name: string) => {
    const v = process.env[name];
    if (!v)
      throw new Error(`Missing protected synthetic test credential: ${name}`);
    return v;
  };
  const a = await login(
    browser,
    url,
    env("SMOKE_EMAIL"),
    env("SMOKE_PASSWORD"),
  );
  const b =
    stage === "preprod"
      ? await login(
          browser,
          url,
          env("SECOND_SMOKE_EMAIL"),
          env("SECOND_SMOKE_PASSWORD"),
        )
      : null;
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    token = a.token,
  ) =>
    a.context.request.fetch(`${url}api/v1/${path}`, {
      method,
      headers: { authorization: token },
      data,
    });
  try {
    const me = await (await request("me")).json();
    expect(me.enabled).toBe(true);
    if (!me.timezone)
      expect(
        (
          await request("me", "PUT", {
            operationId: randomUUID(),
            expectedRevision: me.revision,
            value: { timezone: "America/Denver", activePlanId: null },
          })
        ).ok(),
      ).toBe(true);
    const exerciseId = randomUUID();
    const payload = {
      operationId: randomUUID(),
      expectedRevision: 0,
      value: {
        id: exerciseId,
        name: "Synthetic release smoke",
        muscle: "Back",
        equipment: "Cable",
      },
    };
    expect(
      (await request(`exercises/${exerciseId}`, "PUT", payload)).ok(),
    ).toBe(true);
    expect(
      (await request(`exercises/${exerciseId}`, "PUT", payload)).ok(),
    ).toBe(true);
    if (b)
      expect(
        (
          await request(`exercises/${exerciseId}`, "GET", undefined, b.token)
        ).status(),
      ).toBe(404);
    if (b) {
      const id = randomUUID(),
        now = Date.now(),
        date = new Intl.DateTimeFormat("en-CA", {
          timeZone: me.timezone ?? "America/Denver",
        }).format(new Date());
      const value = {
        id,
        planId: null,
        dayId: null,
        planName: "Synthetic release",
        dayName: "Synthetic smoke session",
        workoutDate: date,
        startedAt: now,
        resumedAt: now,
        elapsedBeforePause: 0,
        exercises: [
          {
            ...payload.value,
            plannedSets: 1,
            position: 0,
            repMin: 8,
            repMax: 12,
            perSide: false,
            supersetGroup: null,
            supersetPosition: null,
            restSeconds: 120,
            sets: [{ setNumber: 1, reps: 10, weight: 37 }],
          },
        ],
      };
      expect(
        (
          await request(`sessions/${id}`, "PUT", {
            operationId: randomUUID(),
            expectedRevision: 0,
            value,
          })
        ).ok(),
      ).toBe(true);
      const finish = {
        operationId: randomUUID(),
        expectedRevision: 1,
        value: null,
      };
      expect(
        (await request(`sessions/${id}/complete`, "POST", finish)).ok(),
      ).toBe(true);
      expect(
        (await request(`sessions/${id}/complete`, "POST", finish)).ok(),
      ).toBe(true);
      expect(
        (await request(`sessions/${id}`, "GET", undefined, b.token)).status(),
      ).toBe(404);
      const before = await (
        await request("history", "GET", undefined, b.token)
      ).json();
      const token = randomBytes(32).toString("base64url"),
        shareId = randomUUID();
      expect(
        (
          await request("shares", "POST", {
            operationId: randomUUID(),
            expectedRevision: 0,
            value: { id: shareId, kind: "SESSION", sourceId: id, token },
          })
        ).ok(),
      ).toBe(true);
      const copy = await (
        await request("shares/redeem", "POST", { token }, b.token)
      ).json();
      expect(copy.planId).toBeTruthy();
      expect(
        await (
          await request("shares/redeem", "POST", { token }, b.token)
        ).json(),
      ).toEqual(copy);
      expect(
        await (await request("history", "GET", undefined, b.token)).json(),
      ).toEqual(before);
      expect(
        (
          await request(`shares/${shareId}/revoke`, "POST", {
            operationId: randomUUID(),
            expectedRevision: 1,
            value: null,
          })
        ).ok(),
      ).toBe(true);
      expect(
        (await request("shares/redeem", "POST", { token }, b.token)).status(),
      ).toBe(404);
    }
    expect((await a.context.request.get(`${url}api/v1/me`)).status()).toBe(401);
    const config = await (
      await a.context.request.get(`${url}runtime-config.json`)
    ).json();
    expect(config.clientId).toBe(out.ClientId);
    // Bounded production smoke writes only one custom exercise for the dedicated user.
  } finally {
    await a.context.close();
    await b?.context.close();
  }
});
