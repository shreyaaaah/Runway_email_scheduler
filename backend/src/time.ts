/** Return the beginning of a UTC hour without mutating the caller's date. */
export function hourWindow(date: Date): Date {
  const window = new Date(date);
  window.setUTCMinutes(0, 0, 0);
  return window;
}

/** Stable UTC hour key shared by Redis rate-limit and statistics lookups. */
export function hourWindowKey(date: Date): string {
  const window = hourWindow(date);
  return [
    window.getUTCFullYear(),
    String(window.getUTCMonth() + 1).padStart(2, "0"),
    String(window.getUTCDate()).padStart(2, "0"),
    String(window.getUTCHours()).padStart(2, "0"),
  ].join("");
}
