import type { Frequency } from "./index";

function localParts(timestamp: number, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
}
function wallTime(timestamp: number, timezone: string) {
  const p = localParts(timestamp, timezone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}
export function nextRunAt(frequency: Frequency, time: string, timezone: string, now: number) {
  if (frequency === "Hourly") return now + 3_600_000;
  const p = localParts(now, timezone);
  const [hour = 9, minute = 0] = time.split(":").map(Number);
  const days = frequency === "Weekly" ? 7 : frequency === "Every 3 days" ? 3 : 1;
  const target = Date.UTC(p.year, p.month - 1, p.day + days, hour, minute);
  let guess = target;
  const candidates: number[] = [];
  for (let i = 0; i < 4; i++) {
    guess += target - wallTime(guess, timezone);
    candidates.push(guess);
    if (wallTime(guess, timezone) === target) return guess;
  }
  // If DST skips the selected time, use the later instant after the gap.
  return Math.max(...candidates);
}
