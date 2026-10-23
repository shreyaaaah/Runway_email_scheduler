import { Router } from "express";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { requireUser } from "./requireUser.js";

const stateSchema = z.object({ userId: z.string(), nonce: z.string(), issuedAt: z.number() });
const oauthResponseSchema = z.object({
  ok: z.boolean(),
  access_token: z.string().optional(),
  incoming_webhook: z.object({ url: z.string().url(), channel: z.string().optional() }).optional(),
});
const router = Router();
router.use(requireUser);

function stateSecret(): string {
  return process.env.SLACK_STATE_SECRET ?? process.env.SESSION_SECRET ?? "local-only-secret";
}

router.get("/connect", (request, response) => {
  if (!process.env.SLACK_CLIENT_ID) {
    response.status(501).json({ error: "Slack OAuth is not configured" });
    return;
  }
  const raw = Buffer.from(JSON.stringify({
    userId: request.user!.id,
    nonce: randomUUID(),
    issuedAt: Date.now(),
  })).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(raw).digest("base64url");
  const redirectUri = encodeURIComponent(process.env.SLACK_REDIRECT_URI ?? "");
  const state = `${raw}.${signature}`;
  response.redirect(`https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}&scope=incoming-webhook&redirect_uri=${redirectUri}&state=${state}`);
});

router.get("/callback", async (request, response) => {
  try {
    const [raw, signature] = String(request.query.state ?? "").split(".");
    if (!raw || !signature) {
      throw new Error("Invalid Slack OAuth state");
    }
    const expected = createHmac("sha256", stateSecret()).update(raw).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new Error("Invalid Slack OAuth signature");
    }
    const parsedState = stateSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString()));
    if (Date.now() - parsedState.issuedAt > 10 * 60_000) {
      throw new Error("Slack OAuth state expired");
    }

    const result = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID ?? "",
        client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
        code: String(request.query.code ?? ""),
        redirect_uri: process.env.SLACK_REDIRECT_URI ?? "",
      }),
    });
    const oauth = oauthResponseSchema.parse(await result.json());
    if (!oauth.ok || !oauth.incoming_webhook?.url) {
      throw new Error("Slack did not return an incoming webhook");
    }
    await db.slackConnection.upsert({
      where: { userId: parsedState.userId },
      update: {
        accessToken: oauth.access_token,
        webhookUrl: oauth.incoming_webhook.url,
        channel: oauth.incoming_webhook.channel,
      },
      create: {
        userId: parsedState.userId,
        accessToken: oauth.access_token,
        webhookUrl: oauth.incoming_webhook.url,
        channel: oauth.incoming_webhook.channel,
      },
    });
    response.redirect(process.env.FRONTEND_URL ?? "/");
  } catch (error) {
    response.status(400).send(error instanceof Error ? error.message : "Slack connection failed");
  }
});

router.get("/status", async (request, response) => {
  const connection = await db.slackConnection.findUnique({ where: { userId: request.user!.id } });
  response.json({ connected: Boolean(connection) });
});

router.delete("/disconnect", async (request, response) => {
  await db.slackConnection.deleteMany({ where: { userId: request.user!.id } });
  response.json({ ok: true });
});

export const slackRouter = router;
