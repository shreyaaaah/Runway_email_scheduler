export type Lead = string;
export type ScheduleSender = { id: string };
export type PlannedEmail = { to: string; senderId: string; scheduledAt: Date };

/** Deterministic ordered plan: round-robin sender assignment, per-sender gap and hourly cap. */
export function planSchedule(input: { leads: Lead[]; senders: ScheduleSender[]; startAt: Date; delayMs: number; hourlyLimit: number }): PlannedEmail[] {
  const { leads, senders, startAt, delayMs, hourlyLimit } = input;
  if (leads.length && !senders.length) throw new Error("At least one sender is required");
  if (delayMs < 0 || hourlyLimit < 1) throw new Error("Invalid scheduling limits");
  const next = senders.map(() => startAt.getTime());
  const hourlyCounts = senders.map(() => new Map<number, number>());
  return leads.map((to, index) => {
    const senderIndex = index % senders.length;
    const hourMs = 3_600_000;
    let at = next[senderIndex];
    let hour = Math.floor(at / hourMs) * hourMs;
    if ((hourlyCounts[senderIndex].get(hour) ?? 0) >= hourlyLimit) { at = hour + hourMs; hour += hourMs; }
    hourlyCounts[senderIndex].set(hour, (hourlyCounts[senderIndex].get(hour) ?? 0) + 1);
    next[senderIndex] = at + Math.max(delayMs, 1);
    return { to, senderId: senders[senderIndex].id, scheduledAt: new Date(at) };
  });
}
