import type {
  CampaignRequest,
  CampaignPreview,
  EmailEvent,
  EmailListResponse,
  SearchResponse,
  Sender,
  User,
} from "./types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json() as Promise<T>;
}

export const api = {
  me(): Promise<User | null> {
    return request<User | null>("/api/me");
  },
  senders(): Promise<Sender[]> {
    return request<Sender[]>("/api/senders");
  },
  createSender(): Promise<Sender> {
    return request<Sender>("/api/senders/test", { method: "POST" });
  },
  listEmails(status: "scheduled" | "sent"): Promise<EmailListResponse> {
    return request<EmailListResponse>(`/api/emails?status=${status}&page=1`);
  },
  search(query: string): Promise<SearchResponse> {
    return request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`);
  },
  events(emailId: string): Promise<EmailEvent[]> {
    return request<EmailEvent[]>(`/api/emails/${emailId}/events`);
  },
  preview(input: CampaignRequest): Promise<CampaignPreview> {
    return request<CampaignPreview>("/api/campaigns/preview", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createCampaign(input: CampaignRequest): Promise<{ campaignId: string; count: number }> {
    return request<{ campaignId: string; count: number }>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  logout(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  },
  slackStatus(): Promise<{ connected: boolean }> {
    return request<{ connected: boolean }>("/api/slack/status");
  },
  disconnectSlack(): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/api/slack/disconnect", { method: "DELETE" });
  },
};
