import { Temporal } from "@js-temporal/polyfill";
export function localDate(now: number, timezone: string) {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}
export function midnight(date: string, timezone: string) {
  return Number(
    Temporal.PlainDate.from(date)
      .add({ days: 1 })
      .toZonedDateTime({ timeZone: timezone, plainTime: "00:00" })
      .epochMilliseconds,
  );
}
export function weekStart(date: string) {
  const d = Temporal.PlainDate.from(date);
  return d.subtract({ days: d.dayOfWeek - 1 }).toString();
}
export function validateTimezone(zone: string) {
  localDate(Date.now(), zone);
  if (/^[+-]/.test(zone)) throw new Error("Use an IANA timezone");
  return zone;
}
