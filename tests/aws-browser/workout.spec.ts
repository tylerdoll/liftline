import { test, expect } from "@playwright/test";
test("same plan-builder interface uses AWS contracts and persists through reauthentication", async ({
  page,
}) => {
  page.on("pageerror", (e) => console.error("Browser error:", e.message));
  page.on("requestfailed", (r) =>
    console.error("Failed request:", r.url(), r.failure()?.errorText),
  );
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Plans", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: /Create plan|New plan/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Create workout plan" });
  await dialog.getByLabel("Plan name").fill("AWS Browser Plan");
  await dialog
    .getByRole("button")
    .filter({ hasText: "Synthetic Press" })
    .click();
  const request = page.waitForRequest(
    (r) => r.url().includes("/api/v1/plans/") && r.method() === "PUT",
  );
  await dialog.getByRole("button", { name: /Save plan/ }).click();
  const payload = (await request).postDataJSON();
  expect(payload.operationId).toBeTruthy();
  expect(payload.expectedRevision).toBe(0);
  expect(payload.value.days[0].exercises[0].exerciseId).toBe("builtin-press");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("button", { name: "Plans", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("AWS Browser Plan", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Account, sharing & recovery" })
    .click();
  await page.getByLabel("Exercise name").fill("Private UI Movement");
  await page.getByLabel("Muscle", { exact: true }).fill("Back");
  await page.getByLabel("Equipment", { exact: true }).fill("Cable");
  await page.getByRole("button", { name: "Add private exercise" }).click();
  await page
    .getByRole("button", { name: "Exercises", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Private UI Movement", exact: true }),
  ).toBeVisible();
  let expiredAuth = true;
  await page.route("**/api/v1/sessions/*", (route) =>
    expiredAuth && route.request().method() === "PUT"
      ? route.fulfill({
          status: 401,
          json: { error: "Synthetic expired authorization" },
        })
      : route.continue(),
  );
  await page
    .getByRole("button", { name: "Today", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Start Workout A/ }).click();
  await page
    .getByLabel("Synthetic Press, set 1, weight", { exact: true })
    .fill("37");
  await page
    .getByLabel("Synthetic Press, set 1, reps", { exact: true })
    .fill("10");
  await expect(
    page.getByText("Sign in again — local edits retained", { exact: true }),
  ).toBeVisible();
  expiredAuth = false;
  await page.reload();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByText(/1 local draft\(s\) need recovery/),
  ).toBeVisible();
  page.on("dialog", (dialog) =>
    dialog.message().startsWith("Resume ") ? dialog.accept() : dialog.dismiss(),
  );
  await page
    .getByRole("button", { name: "Account, sharing & recovery" })
    .click();
  await page.getByRole("button", { name: "Retry sync", exact: true }).click();
  await expect(
    page.getByLabel("Synthetic Press, set 1, weight", { exact: true }),
  ).toHaveValue("37");
  await expect(
    page.getByLabel("Synthetic Press, set 1, reps", { exact: true }),
  ).toHaveValue("10");
  const finished = page.waitForResponse(
    (r) => r.url().endsWith("/complete") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Finish workout/ }).click();
  expect((await finished).status()).toBe(200);
  await expect(
    page.getByRole("dialog", { name: "Log Workout A" }),
  ).not.toBeVisible();
});
