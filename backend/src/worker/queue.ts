import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { Client } from "@elastic/elasticsearch";

export const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export const emailQueue = new Queue("emails", { connection: redis });

export const es = new Client({
  node: process.env.ELASTICSEARCH_URL ?? "http://localhost:9200",
});
