import { test } from "node:test";
import assert from "node:assert/strict";
import { midnight, localDate, weekStart } from "../domain/time";
test("Denver midnight follows DST: spring day has 23 hours, fall day 25", () => {
  assert.equal(
    midnight("2026-03-08", "America/Denver") -
      midnight("2026-03-07", "America/Denver"),
    23 * 3600000,
  );
  assert.equal(
    midnight("2026-11-01", "America/Denver") -
      midnight("2026-10-31", "America/Denver"),
    25 * 3600000,
  );
  assert.equal(
    localDate(Date.parse("2026-09-13T05:59:59Z"), "America/Denver"),
    "2026-09-12",
  );
  assert.equal(weekStart("2026-09-13"), "2026-09-07");
});
