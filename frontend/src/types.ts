export type EmailStatus = "scheduled" | "processing" | "sent" | "failed";

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
}

export interface Sender {
  id: string;
  email: string;
  name: string;
}

export interface Email {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  sender?: Sender;
}

export interface EmailEvent {
  id: string;
  emailId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PlanBucket {
  hour: string;
  count: number;
}

export interface CampaignPreview {
  total: number;
  plan: Array<{ to: string; senderId: string; scheduledAt: string }>;
  buckets: PlanBucket[];
  finishAt: string | null;
}

export interface CampaignRequest {
  leads: string[];
  subject: string;
  body: string;
  startAt: string;
  delayMs: number;
  hourlyLimit: number;
}

export interface EmailListResponse {
  items: Email[];
  total: number;
  page: number;
}

export interface SearchResponse {
  items: Email[];
}
