export type Mode =
  | "Voice Assistant"
  | "Meeting Intelligence"
  | "Knowledge"
  | "Observability"
  | "Settings";
export type ActionItem = {
  description: string;
  owner: string | null;
  deadline: string | null;
  status: "open" | "in_progress" | "done";
  evidence: string;
};
export type Notes = {
  summary: string;
  key_points: string[];
  concepts: string[];
  decisions: string[];
  action_items: ActionItem[];
  open_questions: string[];
  follow_up_topics: string[];
  uncertainties: string[];
};
export type Session = {
  id: string;
  title: string;
  kind: string;
  created_at: string;
  expires_at: string;
  transcript: string;
  notes: Notes | null;
};
export type Message = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};
export type Source = {
  id: string;
  name: string;
  page: number | null;
  excerpt: string;
};
export type Answer = {
  model_latency_ms?: number | null;
  answer: string;
  trace_id: string;
  sources: Source[];
};
export type Document = {
  id: string;
  session_id: string;
  name: string;
  embedding_model: string;
  created_at: string;
};
export type Config = {
  configured: boolean;
  readiness: string;
  model: string;
  embedding_model: string;
  max_input_characters: number;
  max_upload_bytes: number;
  request_timeout_seconds: number;
  session_ttl_hours: number;
  notice: string;
};
export type Trace = {
  id: string;
  session_ref: string | null;
  route: string;
  started_at: string;
  completed_at: string;
  latency_ms: number;
  model_latency_ms: number | null;
  retrieval_latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  success: boolean;
  error_category: string | null;
  nodes: number;
};
export type Metrics = {
  requests: number;
  successes: number;
  error_rate: number | null;
  average_latency_ms: number | null;
  p95_latency_ms: number | null;
  p95_sample_size: number;
  input_tokens: number | null;
  output_tokens: number | null;
  token_measured_requests: number;
  retention_days: number;
};
export type Transcript = {
  transcript: string;
  language: string;
  duration_seconds: number;
  provider: string;
  transcription_latency_ms: number;
  trace_id: string;
};
export type AudioStatus = {
  provider: string;
  model: string;
  device: string;
  compute_type: string;
  state: string;
  ready: boolean;
  last_error: string | null;
  successes: number;
  failures: number;
  last_latency_ms: number | null;
  busy: boolean;
  max_upload_bytes: number;
  max_duration_seconds: number;
  notice: string;
};
