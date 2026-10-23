import { DelayedError, Job, Worker } from "bullmq";
import type { Prisma } from "@prisma/client";
import nodemailer from "nodemailer";
import { db } from "../db.js";
import { hourWindow, hourWindowKey } from "../time.js";
import { RATE_LIMIT_LUA } from "../rateLimit.js";
import { notifyRateLimit } from "../services/slackNotifier.js";
import { emailQueue, es, redis } from "./queue.js";

const minimumGapMs = Number(process.env.MIN_DELAY_MS_BETWEEN_SENDS ?? 1000);
const maximumHourlyEmails = Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 100);
type EmailWithRelations = Prisma.EmailGetPayload<{ include: { sender: true; campaign: true } }>;
const gapScript = `
local ttl = redis.call('PTTL', KEYS[1])
if ttl > 0 then
  return ttl
end
redis.call('SET', KEYS[1], '1', 'PX', ARGV[1])
return 0
`;

async function claimEmail(emailId: string, jobId: string | undefined) {
  const candidate = await db.email.findUnique({
    where: { id: emailId },
    include: { sender: true, campaign: true },
  });
  if (!candidate || (candidate.status !== "scheduled" && candidate.status !== "processing")) {
    return null;
  }

  const now = Date.now();
  const staleBefore = new Date(now - 120_000);
  if (candidate.status === "processing") {
    const staleAt = (candidate.processingAt?.getTime() ?? 0) + 120_000;
    if (staleAt > now) {
      return { delayedFor: staleAt - now + 1_000 } as const;
    }
  }

  const gapKey = `gap:${candidate.senderId}`;
  const gapTtl = Number(await redis.eval(gapScript, 1, gapKey, minimumGapMs));
  if (gapTtl > 0) {
    return { delayedFor: gapTtl } as const;
  }

  const claim = await db.email.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: "scheduled" },
        { status: "processing", processingAt: { lt: staleBefore } },
      ],
    },
    data: { status: "processing", processingAt: new Date() },
  });
  if (!claim.count) {
    return null;
  }

  await db.emailEvent.create({
    data: { emailId: candidate.id, type: "claimed", payload: { jobId: jobId ?? null } },
  });
  return { email: candidate } as const;
}

async function processEmail(job: Job<{ emailId: string }>, token?: string): Promise<void> {
  const claim = await claimEmail(job.data.emailId, job.id);
  if (!claim) {
    return;
  }
  if ("delayedFor" in claim) {
    await job.moveToDelayed(Date.now() + claim.delayedFor + 25, token);
    throw new DelayedError();
  }

  const email = claim.email;
  const hourStart = hourWindow(email.scheduledAt);
  const hourKey = hourWindowKey(email.scheduledAt);
  const rateLimitKey = `rl:${email.senderId}:${hourKey}`;
  const effectiveLimit = Math.min(email.campaign.hourlyLimit, maximumHourlyEmails);
  const reservation = Number(await redis.eval(RATE_LIMIT_LUA, 1, rateLimitKey, effectiveLimit));

  if (reservation === 0) {
    const pushedTo = new Date(
      hourStart.getTime() + 3_600_000 + (email.scheduledAt.getTime() % 60_000),
    );
    await db.email.update({
      where: { id: email.id },
      data: { status: "scheduled", processingAt: null, scheduledAt: pushedTo },
    });
    await db.emailEvent.create({
      data: {
        emailId: email.id,
        type: "rate_limited_rescheduled",
        payload: { pushedTo: pushedTo.toISOString(), limit: effectiveLimit },
      },
    });
    await notifyRateLimit(email.senderId, hourKey, pushedTo, effectiveLimit);
    await job.moveToDelayed(Math.max(Date.now() + 1, pushedTo.getTime()), token);
    throw new DelayedError();
  }

  const transport = nodemailer.createTransport({
    host: email.sender.smtpHost,
    port: email.sender.smtpPort,
    secure: false,
    auth: { user: email.sender.smtpUser, pass: email.sender.smtpPass },
  });

  let info: Awaited<ReturnType<typeof transport.sendMail>>;
  try {
    info = await transport.sendMail({
      from: `${email.sender.name} <${email.sender.email}>`,
      to: email.toEmail,
      subject: email.subject,
      html: email.body,
    });
  } catch (error) {
    await recordSendFailure(job, email, error);
    throw error;
  }

  const sentAt = new Date();
  await db.$transaction([
    db.email.update({
      where: { id: email.id },
      data: { status: "sent", sentAt, processingAt: null },
    }),
    db.emailEvent.create({
      data: {
        emailId: email.id,
        type: "sent",
        payload: { messageId: info.messageId, previewUrl: nodemailer.getTestMessageUrl(info) },
      },
    }),
  ]);
  await es.index({
    index: "emails",
    id: email.id,
    document: {
      id: email.id,
      userId: email.campaign.userId,
      toEmail: email.toEmail,
      subject: email.subject,
      body: email.body,
      scheduledAt: email.scheduledAt,
      sentAt,
      status: "sent",
    },
  });
}

async function recordSendFailure(
  job: Job<{ emailId: string }>,
  email: EmailWithRelations,
  error: unknown,
): Promise<void> {
  const errorText = String(error);
  if (job.attemptsMade + 1 >= 3) {
    await db.email.update({
      where: { id: email.id },
      data: { status: "failed", lastError: errorText, processingAt: null },
    });
    await db.emailEvent.create({
      data: { emailId: email.id, type: "failed", payload: { error: errorText } },
    });
    await es.index({
      index: "emails",
      id: email.id,
      document: {
        id: email.id,
        userId: email.campaign.userId,
        toEmail: email.toEmail,
        subject: email.subject,
        body: email.body,
        scheduledAt: email.scheduledAt,
        sentAt: null,
        status: "failed",
      },
    });
    return;
  }

  await db.email.update({
    where: { id: email.id },
    data: { status: "scheduled", processingAt: null, lastError: errorText },
  });
  await db.emailEvent.create({
    data: {
      emailId: email.id,
      type: "retrying",
      payload: { attempt: job.attemptsMade + 1, error: errorText },
    },
  });
}

export function startEmailWorker(): Worker {
  const worker = new Worker("emails", processEmail, {
    connection: redis,
    concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
  });
  worker.on("error", error => console.error("Email worker error", error));
  return worker;
}

export async function recoverStuckEmails(): Promise<void> {
  const staleBefore = new Date(Date.now() - 120_000);
  const stuckEmails = await db.email.findMany({
    where: { status: "processing", processingAt: { lt: staleBefore } },
    select: { id: true },
  });

  for (const email of stuckEmails) {
    const reset = await db.email.updateMany({
      where: { id: email.id, status: "processing", processingAt: { lt: staleBefore } },
      data: { status: "scheduled", processingAt: null },
    });
    if (!reset.count) {
      continue;
    }
    await db.emailEvent.create({
      data: { emailId: email.id, type: "recovered", payload: { reason: "processing timeout" } },
    });
  }

  const scheduledEmails = await db.email.findMany({
    where: { status: "scheduled" },
    select: { id: true, scheduledAt: true },
  });
  for (const email of scheduledEmails) {
    const jobId = `email:${email.id}`;
    if (await emailQueue.getJob(jobId)) {
      continue;
    }
    await emailQueue.add("send", { emailId: email.id }, {
      jobId,
      delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: true,
    });
  }
}
