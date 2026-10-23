import type { RequestHandler } from "express";

export const requireUser: RequestHandler = (request, response, next) => {
  if (!request.user) {
    response.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
};
