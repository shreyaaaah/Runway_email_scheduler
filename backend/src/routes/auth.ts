import { Router } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { db } from "../db.js";

export function configureGoogleAuth(): void {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return;
  }
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL ?? "http://localhost:4000/api/auth/google/callback",
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) {
        done(new Error("Google did not return an email"));
        return;
      }
      const user = await db.user.upsert({
        where: { email },
        update: { googleId: profile.id, name: profile.displayName, avatar: profile.photos?.[0]?.value },
        create: { googleId: profile.id, email, name: profile.displayName, avatar: profile.photos?.[0]?.value },
      });
      done(null, user);
    } catch (error) {
      done(error as Error);
    }
  }));
}

export const authRouter = Router();

authRouter.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));
authRouter.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: `${process.env.FRONTEND_URL ?? ""}/login` }),
  (_request, response) => response.redirect(process.env.FRONTEND_URL ?? "/"),
);
authRouter.post("/logout", (request, response, next) => {
  request.logout(error => {
    if (error) {
      next(error);
      return;
    }
    request.session.destroy(() => response.json({ ok: true }));
  });
});
authRouter.get("/me", (request, response) => response.json(request.user ?? null));
