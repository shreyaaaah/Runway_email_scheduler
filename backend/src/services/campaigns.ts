import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { emailQueue, es } from "../worker/queue.js";
import { planSchedule } from "../schedule.js";
import { hourWindow } from "../time.js";

export const campaignSchema = z.object({
  leads: z.array(z.string()),
  subject: z.string().min(1),
  body: z.string(),
  startAt: z.string().datetime(),
  delayMs: z.coerce.number().int().min(0),
  hourlyLimit: z.coerce.number().int().min(1),
});

export type CampaignInput = z.infer<typeof campaignSchema>;

export function normalizeLeads(leads: string[]): string[] {
  return [...new Set(leads.map(lead => lead.trim().toLowerCase()).filter(lead =>
    z.string().email().safeParse(lead).success,
  ))];
}

function effectiveDelay(delayMs: number): number {
  return Math.max(delayMs, Number(process.env.MIN_DELAY_MS_BETWEEN_SENDS ?? 1000));
}

export async function previewCampaign(userId: string, input: CampaignInput) {
  const leads = normalizeLeads(input.leads);
  const senders = await db.sender.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!senders.length) {
    throw new Error("Create a sender first");
  }

  const plan = planSchedule({
    leads,
    senders,
    startAt: new Date(input.startAt),
    delayMs: effectiveDelay(input.delayMs),
    hourlyLimit: input.hourlyLimit,
  });
  const buckets = new Map<string, number>();
  for (const email of plan) {
    const hour = hourWindow(email.scheduledAt).toISOString();
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }

  return {
    total: leads.length,
    plan,
    buckets: [...buckets].map(([hour, count]) => ({ hour, count })),
    finishAt: plan.at(-1)?.scheduledAt ?? null,
  };
}

export async function createCampaign(userId: string, input: CampaignInput) {
  const leads = normalizeLeads(input.leads);
  if (!leads.length) {
    throw new Error("No valid unique recipients");
  }

  const senders = await db.sender.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  if (!senders.length) {
    throw new Error("Create a sender first");
  }

  const delayMs = effectiveDelay(input.delayMs);
  const campaignId = randomUUID();
  const plan = planSchedule({
    leads,
    senders,
    startAt: new Date(input.startAt),
    delayMs,
    hourlyLimit: input.hourlyLimit,
  });
  const records = plan.map(item => ({
    id: randomUUID(),
    campaignId,
    toEmail: item.to,
    senderId: item.senderId,
    subject: input.subject,
    body: input.body,
    scheduledAt: item.scheduledAt,
  }));

  await db.$transaction(async tx => {
    await tx.campaign.create({
      data: {
        id: campaignId,
        userId,
        subject: input.subject,
        body: input.body,
        startAt: new Date(input.startAt),
        delayMs,
        hourlyLimit: input.hourlyLimit,
      },
    });
    await tx.email.createMany({ data: records });
    await tx.emailEvent.createMany({
      data: records.map(email => ({
        emailId: email.id,
        type: "queued",
        payload: { scheduledAt: email.scheduledAt.toISOString(), senderId: email.senderId },
      })),
    });
  }, { timeout: 60_000 });

  await emailQueue.addBulk(records.map(email => ({
    name: "send",
    data: { emailId: email.id },
    opts: {
      jobId: `email:${email.id}`,
      delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 2000 },
      removeOnComplete: true,
    },
  })));

  try {
    const operations = records.flatMap(email => [
      { index: { _index: "emails", _id: email.id } },
      {
        id: email.id,
        userId,
        toEmail: email.toEmail,
        subject: email.subject,
        body: email.body,
        scheduledAt: email.scheduledAt,
        sentAt: null,
        status: "scheduled",
      },
    ]);
    const result = await es.bulk({ operations });
    if (result.errors) {
      console.error("Some campaign email documents were not indexed", {
        campaignId,
        failures: result.items.filter(item => item.index?.error),
      });
    }
  } catch (error) {
    console.error("Could not index campaign emails", { campaignId, error });
  }

  return { campaignId, count: records.length };
}
