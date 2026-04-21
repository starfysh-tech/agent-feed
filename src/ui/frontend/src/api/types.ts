export interface Session {
  session_id: string;
  agent: string;
  model: string;
  repo: string | null;
  git_branch: string | null;
  latest_timestamp: string;
  turn_count: number;
  total_flags: number;
  unreviewed_flags: number;
}

export interface Flag {
  id: string;
  record_id: string;
  type: FlagType;
  content: string;
  context: string | null;
  confidence: number;
  review_status: ReviewStatus;
  reviewer_note: string | null;
  outcome: string | null;
}

export interface Record {
  id: string;
  timestamp: string;
  agent: string;
  agent_version: string | null;
  session_id: string;
  turn_index: number;
  repo: string | null;
  working_directory: string;
  git_branch: string | null;
  git_commit: string | null;
  request_summary: string | null;
  response_summary: string;
  raw_request: string | null;
  raw_response: string;
  token_count: number | null;
  model: string;
  flags: Flag[];
}

export interface RawResponse {
  raw_response: string;
  raw_request: string | null;
}

export interface TrendsByType {
  type: string;
  count: number;
  false_positive_rate: number;
}

export interface TrendsBySession {
  session_id: string;
  agent: string;
  repo: string | null;
  git_branch: string | null;
  latest_timestamp: string;
  flag_count: number;
}

export interface Trends {
  total_flags: number;
  by_type: TrendsByType[];
  by_session: TrendsBySession[];
}

export type FlagType =
  | "decision"
  | "assumption"
  | "architecture"
  | "pattern"
  | "dependency"
  | "tradeoff"
  | "constraint"
  | "workaround"
  | "risk";

export type ReviewStatus =
  | "unreviewed"
  | "accepted"
  | "needs_change"
  | "false_positive";
