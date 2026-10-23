import { Queue, Worker, Job, DelayedError } from "bullmq";
import { Redis } from "ioredis";
import { db } from "./db.js";
import nodemailer from "nodemailer";
import { Client } from "@elastic/elasticsearch";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
export const emailQueue = new Queue("emails", { connection: redis });
export const es = new Client({ node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200" });
const minGap = Number(process.env.MIN_DELAY_MS_BETWEEN_SENDS ?? 1000);
const maxHour = Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 100);
const rateScript = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end; if n>tonumber(ARGV[1]) then redis.call('DECR',KEYS[1]); return 0 end; return n`;
const gapScript = `local ttl=redis.call('PTTL',KEYS[1]); if ttl>0 then return ttl end; redis.call('SET',KEYS[1],'1','PX',ARGV[1]); return 0`;

async function notifyRateLimit(senderId: string, hourKey: string, pushedTo: Date, limit: number) {
  const dedupe = `slack-notice:${senderId}:${hourKey}`;
  if (!(await redis.set(dedupe, "1", "EX", 3600, "NX"))) return;
  const sender = await db.sender.findUnique({ where: { id: senderId }, include: { user: { include: { slack: true } } } });
  const webhook = sender?.user.slack?.webhookUrl;
  if (!webhook) return;
  await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `Runway rate limit: ${sender.email} reached ${limit}/hour. Remaining emails moved to ${pushedTo.toISOString()}.` }) }).catch(() => undefined);
}

export function startWorker() {
  const worker = new Worker("emails", async (job: Job<{ emailId: string }>, token?: string) => {
    const claim = await db.email.updateMany({ where: { id: job.data.emailId, status: "scheduled" }, data: { status: "processing", processingAt: new Date() } });
    if (!claim.count) return;
    const email = await db.email.findUnique({ where: { id: job.data.emailId }, include: { sender: true, campaign: true } });
    if (!email) return;
    await db.emailEvent.create({ data: { emailId: email.id, type: "claimed", payload: { jobId: job.id } } });
    const at = new Date(email.scheduledAt); const hourStart = new Date(at); hourStart.setMinutes(0, 0, 0);
    const hourKey = `${hourStart.getUTCFullYear()}${String(hourStart.getUTCMonth()+1).padStart(2,"0")}${String(hourStart.getUTCDate()).padStart(2,"0")}${String(hourStart.getUTCHours()).padStart(2,"0")}`;
    const key = `rl:${email.senderId}:${hourKey}`;
    // First smooth the send rate; BullMQ persists delayed jobs during restarts.
    const gapKey = `gap:${email.senderId}`;
    // Atomic lease closes the race where concurrent jobs could all pass a read-then-set check.
    const gapTtl = Number(await redis.eval(gapScript, 1, gapKey, minGap));
    if (gapTtl > 0) {
      await db.email.update({ where: { id: email.id }, data: { status: "scheduled", processingAt: null } });
      await job.moveToDelayed(Date.now() + gapTtl + 25, token);
      throw new DelayedError();
    }
    const count = await redis.eval(rateScript, 1, key, maxHour);
    if (Number(count) === 0) {
      const pushed = new Date(hourStart.getTime() + 3_600_000 + (email.scheduledAt.getTime() % 60_000));
      await db.email.update({ where: { id: email.id }, data: { status: "scheduled", processingAt: null, scheduledAt: pushed } });
      await db.emailEvent.create({ data: { emailId: email.id, type: "rate_limited_rescheduled", payload: { pushedTo: pushed.toISOString(), limit: maxHour } } });
      await notifyRateLimit(email.senderId, hourKey, pushed, maxHour);
      await job.moveToDelayed(Math.max(Date.now() + 1, pushed.getTime()), token);
      // DelayedError tells BullMQ the active job was deliberately moved, not failed.
      throw new DelayedError();
    }
    const transport = nodemailer.createTransport({ host: email.sender.smtpHost, port: email.sender.smtpPort, secure: false, auth: { user: email.sender.smtpUser, pass: email.sender.smtpPass } });
    try {
      const info = await transport.sendMail({ from: `${email.sender.name} <${email.sender.email}>`, to: email.toEmail, subject: email.subject, html: email.body });
      await db.$transaction([db.email.update({ where: { id: email.id }, data: { status: "sent", sentAt: new Date(), processingAt: null } }), db.emailEvent.create({ data: { emailId: email.id, type: "sent", payload: { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) } } })]);
      await es.index({ index: "emails", id: email.id, document: { userId: email.campaign.userId, to: email.toEmail, subject: email.subject, body: email.body, status: "sent" } });
    } catch (error) {
      if (job.attemptsMade + 1 >= 3) { await db.email.update({ where: { id: email.id }, data: { status: "failed", lastError: String(error), processingAt: null } }); await db.emailEvent.create({ data: { emailId: email.id, type: "failed", payload: { error: String(error) } } }); }
      else { await db.email.update({ where: { id: email.id }, data: { status: "scheduled", processingAt: null, lastError: String(error) } }); await db.emailEvent.create({ data: { emailId: email.id, type: "retrying", payload: { attempt: job.attemptsMade + 1, error: String(error) } } }); }
      throw error;
    }
  }, { connection: redis, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5) });
  worker.on("error", error => console.error("Email worker error", error));
  return worker;
}

export async function recoverStuckEmails() {
  const stuck = await db.email.findMany({ where: { status: "processing", processingAt: { lt: new Date(Date.now() - 120_000) } }, select: { id: true } });
  for (const { id } of stuck) {
    const result = await db.email.updateMany({ where: { id, status: "processing" }, data: { status: "scheduled", processingAt: null } });
    if (!result.count) continue;
    await db.emailEvent.create({ data: { emailId: id, type: "recovered", payload: { reason: "processing timeout" } } });
  }
  // Also closes the DB-commit/queue-enqueue crash window during campaign creation.
  const scheduled = await db.email.findMany({ where: { status: "scheduled" }, select: { id: true, scheduledAt: true } });
  for (const email of scheduled) {
    const jobId = `email:${email.id}`;
    if (await emailQueue.getJob(jobId)) continue;
    await emailQueue.add("send", { emailId: email.id }, { jobId, delay: Math.max(0, email.scheduledAt.getTime() - Date.now()), attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true });
  }
}
