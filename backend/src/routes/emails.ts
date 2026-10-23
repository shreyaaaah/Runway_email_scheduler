import { Router } from "express";
import nodemailer from "nodemailer";
import { db } from "../db.js";
import { hourWindowKey } from "../time.js";
import { redis, es } from "../worker/queue.js";
import { requireUser } from "./requireUser.js";

interface EmailSearchDocument {
  id: string;
  userId: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
}

export const emailsRouter = Router();

emailsRouter.get("/emails", requireUser, async (request, response) => {
  const statuses = request.query.status === "sent" ? ["sent", "failed"] : ["scheduled", "processing"];
  const page = Math.max(1, Number(request.query.page ?? 1));
  const where = { status: { in: statuses }, campaign: { userId: request.user!.id } };
  const [items, total] = await Promise.all([
    db.email.findMany({
      where,
      include: { sender: true },
      orderBy: { scheduledAt: "desc" },
      skip: (page - 1) * 50,
      take: 50,
    }),
    db.email.count({ where }),
  ]);
  response.json({ items, total, page });
});

emailsRouter.get("/emails/:id/events", requireUser, async (request, response) => {
  const email = await db.email.findFirst({
    where: { id: request.params.id, campaign: { userId: request.user!.id } },
    include: { events: { orderBy: { createdAt: "asc" } } },
  });
  if (!email) {
    response.sendStatus(404);
    return;
  }
  response.json(email.events);
});

emailsRouter.get("/search", requireUser, async (request, response) => {
  const query = String(request.query.q ?? "");
  if (!query) {
    response.json({ items: [] satisfies EmailSearchDocument[] });
    return;
  }
  const result = await es.search<EmailSearchDocument>({
    index: "emails",
    query: {
      bool: {
        must: [{ multi_match: { query, fields: ["toEmail", "subject", "body", "status"] } }],
        filter: [{ term: { userId: request.user!.id } }],
      },
    },
  }).catch(() => null);
  response.json({ items: result?.hits.hits.flatMap(hit => hit._source ? [hit._source] : []) ?? [] });
});

emailsRouter.get("/stats", requireUser, async (request, response) => {
  const userId = request.user!.id;
  const [scheduled, sent, failed, senders] = await Promise.all([
    db.email.count({ where: { status: { in: ["scheduled", "processing"] }, campaign: { userId } } }),
    db.email.count({ where: { status: "sent", campaign: { userId } } }),
    db.email.count({ where: { status: "failed", campaign: { userId } } }),
    db.sender.findMany({ where: { userId } }),
  ]);
  const hourKey = hourWindowKey(new Date());
  const usage = await Promise.all(senders.map(async sender => ({
    senderId: sender.id,
    email: sender.email,
    used: Number(await redis.get(`rl:${sender.id}:${hourKey}`) ?? 0),
    limit: Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER ?? 100),
  })));
  response.json({ scheduled, sent, failed, usage });
});

emailsRouter.post("/senders/test", requireUser, async (request, response) => {
  const account = await nodemailer.createTestAccount();
  const sender = await db.sender.create({
    data: {
      userId: request.user!.id,
      email: account.user,
      name: request.user!.name,
      smtpHost: account.smtp.host,
      smtpPort: account.smtp.port,
      smtpUser: account.user,
      smtpPass: account.pass,
    },
  });
  response.status(201).json(sender);
});

emailsRouter.get("/senders", requireUser, async (request, response) => {
  const senders = await db.sender.findMany({
    where: { userId: request.user!.id },
    orderBy: { createdAt: "asc" },
  });
  response.json(senders);
});
