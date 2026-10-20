import type { DeskStatus } from "../shared/types.js";

export interface RefreshResponse {
  inserted: number;
  updated: number;
  unchanged: number;
  sourceCount: number;
  failedSourceCount: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(`Strežnik je vrnil napako ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export function getDesk(): Promise<DeskStatus> {
  return request<DeskStatus>("/api/desk");
}

export function refreshFeeds(): Promise<RefreshResponse> {
  return request<RefreshResponse>("/api/refresh", { method: "POST" });
}

export function setStorySaved(storyId: string, saved: boolean): Promise<{ storyId: string; saved: boolean }> {
  return request(`/api/stories/${encodeURIComponent(storyId)}/saved`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ saved }),
  });
}
