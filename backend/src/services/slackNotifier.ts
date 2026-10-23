import { db } from "../db.js";
import { redis } from "../worker/queue.js";

export async function notifyRateLimit(
  senderId: string,
  hourKey: string,
  pushedTo: Date,
  limit: number,
): Promise<void> {
  const sender = await db.sender.findUnique({
    where: { id: senderId },
    include: { user: { include: { slack: true } } },
  });
  const webhook = sender?.user.slack?.webhookUrl;
  if (!sender || !webhook) {
    return;
  }

  const dedupeKey = `slack-notice:${senderId}:${hourKey}`;
  const firstNotice = await redis.set(dedupeKey, "1", "EX", 3600, "NX");
  if (!firstNotice) {
    return;
  }

  await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `Runway rate limit: ${sender.email} reached ${limit}/hour. Remaining emails moved to ${pushedTo.toISOString()}.`,
    }),
  }).catch(() => undefined);
}
