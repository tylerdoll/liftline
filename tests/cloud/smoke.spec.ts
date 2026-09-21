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
  try {
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
  } catch {
    await context.close();
    // Playwright locator errors can include filled credentials and OAuth URLs.
    throw new Error(
      "Synthetic managed login failed; credential details suppressed",
    );
  }
}
test("real managed login, same-origin API, isolation, durable completion and copying", async ({
  browser,
}) => {
  const stage = process.env.STAGE;
  if (!["beta", "prod"].includes(stage ?? ""))
    throw new Error("Cloud suite requires explicit STAGE=beta or STAGE=prod");
  const out = JSON.parse(
    await readFile(`release/${stage}-outputs.json`, "utf8"),
  );
  const url = new URL(out.Url).href;
  if (!url.startsWith("https://")) throw new Error("Cloud tests require HTTPS");
  if (
    stage === "beta" &&
    process.env.SMOKE_EMAIL === process.env.SECOND_SMOKE_EMAIL
  )
    throw new Error(
      "Beta integration requires two distinct synthetic identities",
    );
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
    stage === "beta"
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
    a.context.request
      .fetch(`${url}api/v1/${path}`, {
        method,
        headers: { authorization: token },
        data,
      })
      .catch(() => {
        throw new Error(
          "Cloud API transport failed; authorization details suppressed",
        );
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
    const saved = await (await request(`exercises/${exerciseId}`)).json();
    expect(saved).toMatchObject({ ...payload.value, revision: 1 });
    expect(
      (await request(`exercises/${exerciseId}`, "PUT", payload)).ok(),
    ).toBe(true);
    expect(await (await request(`exercises/${exerciseId}`)).json()).toEqual(
      saved,
    );
    expect(
      (
        await request(`exercises/${exerciseId}`, "PUT", {
          ...payload,
          value: { ...payload.value, name: "Changed operation input" },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await request(`exercises/${exerciseId}`, "PUT", {
          ...payload,
          operationId: randomUUID(),
        })
      ).status(),
    ).toBe(409);
    if (b)
      expect(
        (
          await request(`exercises/${exerciseId}`, "GET", undefined, b.token)
        ).status(),
      ).toBe(404);
    if (b) {
      const other = await (
        await request("me", "GET", undefined, b.token)
      ).json();
      expect(other.enabled).toBe(true);
      expect(other.id).not.toBe(me.id);
      const raced = await Promise.all(
        ["First writer", "Second writer"].map((name) =>
          request(`exercises/${exerciseId}`, "PUT", {
            operationId: randomUUID(),
            expectedRevision: 1,
            value: { ...payload.value, name },
          }),
        ),
      );
      expect(raced.map((response) => response.status()).sort()).toEqual([
        200, 409,
      ]);
      expect(
        (await (await request(`exercises/${exerciseId}`)).json()).revision,
      ).toBe(2);
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
      const completed = await (await request(`sessions/${id}`)).json();
      expect(completed).toMatchObject({ id, status: "completed", revision: 2 });
      expect(
        (
          await request(`sessions/${id}`, "PUT", {
            operationId: randomUUID(),
            expectedRevision: 2,
            value,
          })
        ).status(),
      ).toBe(409);
      const progress = await (await request(`progress/${exerciseId}`)).json();
      expect(
        progress.items.filter(
          (item: { sessionId: string }) => item.sessionId === id,
        ),
      ).toHaveLength(1);
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
      const copiedPlan = await request(
        `plans/${copy.planId}`,
        "GET",
        undefined,
        b.token,
      );
      expect(copiedPlan.status()).toBe(200);
      const template = await copiedPlan.json();
      expect(template.days).toHaveLength(1);
      expect(template.days[0].exercises).toHaveLength(1);
      expect(template.days[0].exercises[0].exerciseId).not.toBe(exerciseId);
      expect((await request(`plans/${copy.planId}`)).status()).toBe(404);
      expect(
        (
          await request(
            `shares/${shareId}/revoke`,
            "POST",
            {
              operationId: randomUUID(),
              expectedRevision: 1,
              value: null,
            },
            b.token,
          )
        ).status(),
      ).toBe(404);
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
    expect(
      (
        await request("me", "GET", undefined, "Bearer invalid-synthetic-token")
      ).status(),
    ).toBe(401);
    const config = await (
      await a.context.request.get(`${url}runtime-config.json`)
    ).json();
    expect(config.clientId === out.ClientId).toBe(true);
    // Bounded production smoke writes only one custom exercise for the dedicated user.
  } finally {
    await a.context.close();
    await b?.context.close();
  }
});
