import { Router } from "express";
import { requireUser } from "./requireUser.js";

export const devRouter = Router();

if (process.env.NODE_ENV !== "production") {
  devRouter.post("/kill-worker", requireUser, (_request, response) => {
    response.json({ ok: true });
    setTimeout(() => process.exit(1), 100);
  });
}
