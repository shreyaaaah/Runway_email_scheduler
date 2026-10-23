import { Router } from "express";
import { campaignSchema, createCampaign, previewCampaign } from "../services/campaigns.js";
import { requireUser } from "./requireUser.js";

export const campaignsRouter = Router();
campaignsRouter.use(requireUser);

campaignsRouter.post("/preview", async (request, response) => {
  const parsed = campaignSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    response.json(await previewCampaign(request.user!.id, parsed.data));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Preview failed" });
  }
});

campaignsRouter.post("/", async (request, response) => {
  const parsed = campaignSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    response.status(201).json(await createCampaign(request.user!.id, parsed.data));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Campaign creation failed" });
  }
});
