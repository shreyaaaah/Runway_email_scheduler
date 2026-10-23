import "dotenv/config";
import express from "express";
import session from "express-session";
import passport from "passport";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { authRouter, configureGoogleAuth } from "./routes/auth.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { devRouter } from "./routes/dev.js";
import { emailsRouter } from "./routes/emails.js";
import { queuesRouter } from "./routes/queues.js";
import { slackRouter } from "./routes/slack.js";
import { recoverStuckEmails, startEmailWorker } from "./worker/emailWorker.js";

const app = express();
const sessionRedis = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
const sessionStore = new RedisStore({ client: sessionRedis });

app.set("trust proxy", 1);
app.use(express.json({ limit: "5mb" }));
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET ?? "local-only-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: Express.User, done) => done(null, user));
configureGoogleAuth();

app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api", emailsRouter);
app.use("/api/slack", slackRouter);
app.use("/api/dev", devRouter);
app.use("/admin/queues", queuesRouter);
app.get("/api/me", (request, response) => response.json(request.user ?? null));

const frontendCandidates = [
  path.resolve(process.cwd(), "frontend/dist"),
  path.resolve(process.cwd(), "../frontend/dist"),
  fileURLToPath(new URL("../../../frontend/dist", import.meta.url)),
];
const frontendDist = frontendCandidates.find(candidate => existsSync(candidate));
if (process.env.NODE_ENV === "production" && frontendDist) {
  app.use(express.static(frontendDist));
  app.get("*", (request, response, next) => {
    if (request.path.startsWith("/api/") || request.path.startsWith("/admin/")) {
      next();
      return;
    }
    response.sendFile(path.join(frontendDist, "index.html"));
  });
}

const port = Number(process.env.PORT ?? 4000);

async function startServer(): Promise<void> {
  await sessionRedis.connect();
  await recoverStuckEmails();
  startEmailWorker();
  app.listen(port, () => console.log(`Runway API listening on ${port}`));
}

void startServer();
