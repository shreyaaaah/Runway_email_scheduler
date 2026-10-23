import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../worker/queue.js";

const router = Router();
const adapter = new ExpressAdapter();
adapter.setBasePath("/admin/queues");
createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter: adapter });

router.use((request, response, next) => {
  const username = process.env.QUEUE_ADMIN_USER ?? "admin";
  const password = process.env.QUEUE_ADMIN_PASSWORD ?? "change-me";
  const expected = Buffer.from(`${username}:${password}`).toString("base64");
  if (request.headers.authorization !== `Basic ${expected}`) {
    response.setHeader("WWW-Authenticate", "Basic realm=queues");
    response.sendStatus(401);
    return;
  }
  next();
});
router.use(adapter.getRouter());

export const queuesRouter = router;
