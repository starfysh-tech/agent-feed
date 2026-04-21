import type { Session, Record, RawResponse, Trends, ReviewStatus } from "./types";

const BASE = "";

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function fetchSessions(params: {
  agent?: string;
  date?: string;
}): Promise<Session[]> {
  const sp = new URLSearchParams();
  if (params.agent) sp.set("agent", params.agent);
  if (params.date) sp.set("date", params.date);
  const qs = sp.toString();
  return fetchJSON(`/api/sessions${qs ? `?${qs}` : ""}`);
}

export function fetchSession(sessionId: string): Promise<Record[]> {
  return fetchJSON(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export function fetchRawRecord(
  sessionId: string,
  recordId: string,
): Promise<RawResponse> {
  return fetchJSON(
    `/api/sessions/${encodeURIComponent(sessionId)}/records/${encodeURIComponent(recordId)}/raw`,
  );
}

export function updateFlag(
  flagId: string,
  data: {
    review_status?: ReviewStatus;
    reviewer_note?: string | null;
    outcome?: string | null;
  },
): Promise<{ ok: boolean }> {
  return fetchJSON(`/api/flags/${encodeURIComponent(flagId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function bulkUpdateFlags(
  flagIds: string[],
  reviewStatus: ReviewStatus,
): Promise<{ ok: boolean; updated: number }> {
  return fetchJSON("/api/flags/bulk", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ flag_ids: flagIds, review_status: reviewStatus }),
  });
}

export function fetchTrends(params: {
  agent?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<Trends> {
  const sp = new URLSearchParams();
  if (params.agent) sp.set("agent", params.agent);
  if (params.dateFrom) sp.set("dateFrom", params.dateFrom);
  if (params.dateTo) sp.set("dateTo", params.dateTo);
  const qs = sp.toString();
  return fetchJSON(`/api/trends${qs ? `?${qs}` : ""}`);
}
