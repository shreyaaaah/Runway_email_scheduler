import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { z } from "zod";
import nodemailer from "nodemailer";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
import { planSchedule } from "./schedule.js";
import { emailQueue, es, redis, startWorker, recoverStuckEmails } from "./queue.js";

declare global { namespace Express { interface User { id: string; email: string; name: string; avatar?: string | null } } }
const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(session({ secret: process.env.SESSION_SECRET ?? "local-only-secret", resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 86400000 } }));
app.use(passport.initialize()); app.use(passport.session());
passport.serializeUser((user, done) => done(null, user)); passport.deserializeUser((user: Express.User, done) => done(null, user));
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) passport.use(new GoogleStrategy({ clientID: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, callbackURL: process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/api/auth/google/callback" }, async (_a, _r, profile, done) => {
  try { const email = profile.emails?.[0]?.value; if (!email) return done(new Error("Google did not return an email")); const user = await db.user.upsert({ where: { email }, update: { googleId: profile.id, name: profile.displayName, avatar: profile.photos?.[0]?.value }, create: { googleId: profile.id, email, name: profile.displayName, avatar: profile.photos?.[0]?.value } }); done(null, user); } catch (e) { done(e as Error); }
}));
const requireUser: express.RequestHandler = (req, res, next) => req.user ? next() : res.status(401).json({ error: "Sign in required" });
const sendersFor = (userId: string) => db.sender.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
app.get("/api/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/api/auth/google/callback", passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL}/login` }), (_req, res) => res.redirect(process.env.FRONTEND_URL ?? "http://localhost:5173"));
app.post("/api/auth/logout", (req, res, next) => req.logout(err => err ? next(err) : req.session.destroy(() => res.json({ ok: true }))));
app.get("/api/me", (req, res) => res.json(req.user ?? null));

const leadsSchema = z.array(z.string().email()).min(1);
const campaignSchema = z.object({ leads: z.array(z.string()), subject: z.string().min(1), body: z.string(), startAt: z.string().datetime(), delayMs: z.coerce.number().int().min(0), hourlyLimit: z.coerce.number().int().min(1) });
app.post("/api/campaigns/preview", requireUser, async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { leads, startAt, delayMs, hourlyLimit } = parsed.data;
  const valid = [...new Set(leads.map(x => x.trim()).filter(x => z.string().email().safeParse(x).success))];
  const senders = await sendersFor(req.user!.id); if (!senders.length) return res.status(400).json({ error: "Create a sender first" });
  const plan = planSchedule({ leads: valid, senders, startAt: new Date(startAt), delayMs, hourlyLimit });
  const buckets = new Map<string, number>(); for (const item of plan) { const h = new Date(item.scheduledAt); h.setMinutes(0,0,0); const key = h.toISOString(); buckets.set(key, (buckets.get(key) ?? 0) + 1); }
  res.json({ total: valid.length, plan, buckets: [...buckets].map(([hour,count])=>({hour,count})), finishAt: plan.at(-1)?.scheduledAt ?? null });
});
app.post("/api/campaigns", requireUser, async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { leads, subject, body, startAt, delayMs, hourlyLimit } = parsed.data;
  const valid = [...new Set(leads.map(x => x.trim()).filter(x => z.string().email().safeParse(x).success))];
  if (!valid.length) return res.status(400).json({ error: "No valid unique recipients" });
  const senders = await sendersFor(req.user!.id); if (!senders.length) return res.status(400).json({ error: "Create a sender first" });
  const plan = planSchedule({ leads: valid, senders, startAt: new Date(startAt), delayMs, hourlyLimit });
  const result = await db.$transaction(async tx => {
    const campaign = await tx.campaign.create({ data: { userId: req.user!.id, subject, body, startAt: new Date(startAt), delayMs, hourlyLimit } });
    const records = await Promise.all(plan.map(item => tx.email.create({ data: { campaignId: campaign.id, toEmail: item.to, senderId: item.senderId, subject, body, scheduledAt: item.scheduledAt }, include: { sender: true } })));
    await tx.emailEvent.createMany({ data: records.map(row => ({ emailId: row.id, type: "queued", payload: { scheduledAt: row.scheduledAt.toISOString(), senderId: row.senderId } })) });
    return records;
  });
  for (const row of result) { await emailQueue.add("send", { emailId: row.id }, { jobId: `email:${row.id}`, delay: Math.max(0, row.scheduledAt.getTime() - Date.now()), attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: true }); await es.index({ index: "emails", id: row.id, document: { userId: req.user!.id, to: row.toEmail, subject, body, status: "scheduled" } }); }
  res.status(201).json({ campaignId: result[0]?.campaignId, count: result.length });
});

app.get("/api/emails", requireUser, async (req,res) => { const status = req.query.status === "sent" ? "sent" : "scheduled"; const page = Math.max(1, Number(req.query.page ?? 1)); const [items,total] = await Promise.all([db.email.findMany({ where: { status, campaign: { userId: req.user!.id } }, include: { sender: true }, orderBy: { scheduledAt: "desc" }, skip: (page-1)*50, take: 50 }), db.email.count({ where: { status, campaign: { userId: req.user!.id } } })]); res.json({ items, total, page }); });
app.get("/api/emails/:id/events", requireUser, async (req,res) => { const email = await db.email.findFirst({ where: { id: req.params.id, campaign: { userId: req.user!.id } }, include: { events: { orderBy: { createdAt: "asc" } } } }); if (!email) return res.sendStatus(404); res.json(email.events); });
app.get("/api/search", requireUser, async (req,res) => { const q = String(req.query.q ?? ""); if (!q) return res.json({ items: [] }); const r = await es.search({ index:"emails", query:{ bool:{ must:[{ multi_match:{ query:q, fields:["to","subject","body","status"] } }], filter:[{ term:{ userId:req.user!.id } }] } } }).catch(()=>null); res.json({ items: r?.hits.hits.map(h=>h._source) ?? [] }); });
app.get("/api/stats", requireUser, async (req,res) => { const [scheduled,sent,failed,senders] = await Promise.all([db.email.count({where:{status:"scheduled",campaign:{userId:req.user!.id}}}),db.email.count({where:{status:"sent",campaign:{userId:req.user!.id}}}),db.email.count({where:{status:"failed",campaign:{userId:req.user!.id}}}),sendersFor(req.user!.id)]); const usage = await Promise.all(senders.map(async s=>({senderId:s.id,email:s.email,used:Number(await redis.get(`rl:${s.id}:${new Date().toISOString().slice(0,13).replace(/[-T:]/g,"")}`)??0),limit:Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER??100)}))); res.json({scheduled,sent,failed,usage}); });

app.post("/api/senders/test", requireUser, async (req,res) => { const account = await nodemailer.createTestAccount(); const sender = await db.sender.create({ data:{ userId:req.user!.id,email:account.user,name:req.user!.name,smtpHost:account.smtp.host,smtpPort:account.smtp.port,smtpUser:account.user,smtpPass:account.pass } }); res.status(201).json(sender); });
app.get("/api/senders", requireUser, async (req,res)=>res.json(await sendersFor(req.user!.id)));

app.get("/api/slack/connect", requireUser, (req,res) => { const client = process.env.SLACK_CLIENT_ID; if(!client) return res.status(501).json({error:"Slack OAuth is not configured"}); const raw = Buffer.from(JSON.stringify({userId:req.user!.id,nonce:randomUUID(),issuedAt:Date.now()})).toString("base64url"); const signature=createHmac("sha256",process.env.SLACK_STATE_SECRET??process.env.SESSION_SECRET??"local-only-secret").update(raw).digest("base64url"); const state=`${raw}.${signature}`; res.redirect(`https://slack.com/oauth/v2/authorize?client_id=${client}&scope=incoming-webhook&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI??"")}&state=${state}`); });
app.get("/api/slack/callback", async (req,res) => { try { const [raw,signature]=String(req.query.state??"").split("."); if(!raw||!signature)throw new Error("Invalid Slack OAuth state"); const expected=createHmac("sha256",process.env.SLACK_STATE_SECRET??process.env.SESSION_SECRET??"local-only-secret").update(raw).digest(); const supplied=Buffer.from(signature,"base64url"); if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))throw new Error("Invalid Slack OAuth signature"); const state=JSON.parse(Buffer.from(raw,"base64url").toString()); if(Date.now()-state.issuedAt>10*60_000)throw new Error("Slack OAuth state expired"); const response=await fetch("https://slack.com/api/oauth.v2.access",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:process.env.SLACK_CLIENT_ID??"",client_secret:process.env.SLACK_CLIENT_SECRET??"",code:String(req.query.code),redirect_uri:process.env.SLACK_REDIRECT_URI??""})}); const data:any=await response.json(); if(!data.ok||!data.incoming_webhook?.url) throw new Error("Slack did not return a webhook"); await db.slackConnection.upsert({where:{userId:state.userId},update:{accessToken:data.access_token,webhookUrl:data.incoming_webhook.url,channel:data.incoming_webhook.channel},create:{userId:state.userId,accessToken:data.access_token,webhookUrl:data.incoming_webhook.url,channel:data.incoming_webhook.channel}}); res.redirect(process.env.FRONTEND_URL??"http://localhost:5173"); } catch(e) { res.status(400).send(String(e)); } });
app.delete("/api/slack/disconnect",requireUser,async(req,res)=>{await db.slackConnection.deleteMany({where:{userId:req.user!.id}});res.json({ok:true});});
app.get("/api/slack/status",requireUser,async(req,res)=>res.json({connected:!!await db.slackConnection.findUnique({where:{userId:req.user!.id}})}));

if (process.env.NODE_ENV !== "production") app.post("/api/dev/kill-worker", requireUser, (_req,res)=>{res.json({ok:true}); setTimeout(()=>process.exit(1),100);});
const boardAdapter=new ExpressAdapter(); boardAdapter.setBasePath("/admin/queues"); createBullBoard({queues:[new BullMQAdapter(emailQueue)],serverAdapter:boardAdapter});
app.use("/admin/queues",(req,res,next)=>{const token=Buffer.from(`${process.env.QUEUE_ADMIN_USER??"admin"}:${process.env.QUEUE_ADMIN_PASSWORD??"change-me"}`).toString("base64"); if(req.headers.authorization!==`Basic ${token}`){res.setHeader("WWW-Authenticate","Basic realm=queues");return res.sendStatus(401)} next();},boardAdapter.getRouter());
const port=Number(process.env.PORT??4000); app.listen(port,async()=>{await recoverStuckEmails();startWorker();console.log(`Runway API listening on ${port}`);});
