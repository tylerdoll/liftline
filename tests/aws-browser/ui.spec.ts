import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`interface remains usable at ${viewport.width}px with bundled fonts and keyboard dialogs`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("navigation", {
        name: viewport.width < 700 ? "Mobile navigation" : "Primary navigation",
      }),
    ).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family === "Roboto" && font.status === "loaded",
        ),
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => getComputedStyle(document.body).fontFamily),
    ).toContain("Roboto");
    const navigation = page.getByRole("navigation", {
      name: viewport.width < 700 ? "Mobile navigation" : "Primary navigation",
    });
    await page.screenshot({
      path: test.info().outputPath("today.png"),
      fullPage: false,
    });
    await navigation
      .getByRole("button", { name: "Plans", exact: true })
      .click();
    await page
      .getByRole("button", { name: /Create plan|New plan/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Create workout plan" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Plan name").fill(`UI ${viewport.width}`);
    await dialog.getByRole("checkbox", { name: /Pair as supersets/ }).check();
    await dialog
      .getByRole("button")
      .filter({ hasText: "Synthetic Press" })
      .click();
    await page.screenshot({
      path: test.info().outputPath("builder.png"),
      fullPage: false,
    });
    // Focus must remain inside the modal when tabbing through all controls.
    for (let i = 0; i < 35; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await dialog.getByRole("button", { name: /Save plan/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: `UI ${viewport.width}`, exact: true }),
    ).toBeVisible();
    const plan = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: `UI ${viewport.width}`,
        exact: true,
      }),
    });
    await plan.getByRole("button", { name: "Make active" }).click();
    await expect(
      plan.getByRole("button", { name: "Make active" }),
    ).not.toBeVisible();
    await plan
      .getByRole("button", {
        name: "Start incomplete Workout A session",
        exact: true,
      })
      .last()
      .click();
    const logger = page.getByRole("dialog", { name: "Log Workout A" });
    await expect(logger).toBeVisible();
    await logger
      .getByLabel("Synthetic Press, set 1, weight", { exact: true })
      .fill("45");
    await logger
      .getByLabel("Synthetic Press, set 1, reps", { exact: true })
      .fill("8");
    await logger.getByRole("button", { name: "Swap Synthetic Press" }).click();
    const swap = page.getByRole("dialog", { name: "Swap Synthetic Press" });
    await expect(
      swap.getByRole("textbox", { name: "Search replacement exercises" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(swap).not.toBeVisible();
    await expect(logger).toBeVisible();
    await expect(
      logger.getByLabel("Synthetic Press, set 1, weight", { exact: true }),
    ).toHaveValue("45");
    await page.screenshot({
      path: test.info().outputPath("logger.png"),
      fullPage: false,
    });
    expect(
      await logger.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await logger.getByRole("button", { name: /Finish workout/ }).click();
    await expect(logger).not.toBeVisible();
    await page
      .getByRole("button", { name: /Create plan/ })
      .first()
      .click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await navigation
      .getByRole("button", { name: "Exercises", exact: true })
      .click();
    await page.getByPlaceholder("Search exercises").fill("Synthetic");
    await page.screenshot({
      path: test.info().outputPath("exercises.png"),
      fullPage: false,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
