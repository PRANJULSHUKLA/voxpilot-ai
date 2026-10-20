import { useEffect, useState } from "react";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  Timer,
  Coins,
  ArrowUpRight,
} from "lucide-react";
import { api } from "../services/api";
import type { AudioStatus, Metrics, Trace } from "../types";
const latency = (n: number | null) =>
  n === null
    ? "—"
    : n >= 1000
      ? `${(n / 1000).toFixed(2)} s`
      : `${Math.round(n)} ms`;
export function Observability({
  perform,
  busy,
}: {
  perform: (fn: () => Promise<void>) => void;
  busy: boolean;
}) {
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null),
    [traces, setTraces] = useState<Trace[]>([]);
  const refresh = async () => {
    const [m, t, a] = await Promise.all([
      api<Metrics>("/observability/summary"),
      api<Trace[]>("/observability/traces"),
      api<AudioStatus>("/audio/status"),
    ]);
    setAudio(a);
    setMetrics(m);
    setTraces(t);
  };
  useEffect(() => {
    perform(refresh);
  }, []);
  const max = Math.max(1, ...traces.map((t) => t.latency_ms));
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">UNDER THE HOOD</span>
          <h2>A clear view of every request.</h2>
          <p className="muted">
            Actual request metrics. No conversation payloads.
          </p>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => perform(refresh)}
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
      <div className="local-diagnostics">
        {[
          {
            label: "Local transcription",
            value: audio?.state || "Unavailable",
            detail: `${audio?.model || "—"} · ${audio?.compute_type || "—"}`,
          },
          {
            label: "Recognized recordings",
            value: audio?.successes ?? "—",
            detail: "Since backend startup",
          },
          {
            label: "Transcription failures",
            value: audio?.failures ?? "—",
            detail: audio?.last_error || "No recorded error",
          },
          {
            label: "Last STT latency",
            value: latency(audio?.last_latency_ms ?? null),
            detail: "Measured decode + load + inference",
          },
        ].map((item) => (
          <div className="panel" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      <div className="metric-grid">
        {[
          {
            label: "Processed requests",
            value: metrics?.requests ?? "—",
            icon: Activity,
            detail: `Last ${metrics?.retention_days ?? 7} days`,
          },
          {
            label: "Average latency",
            value: latency(metrics?.average_latency_ms ?? null),
            icon: Timer,
            detail: `P95 ${latency(metrics?.p95_latency_ms ?? null)} · ${metrics?.p95_sample_size ?? 0} recent samples`,
          },
          {
            label: "Success rate",
            value:
              metrics?.error_rate == null
                ? "—"
                : `${((1 - metrics.error_rate) * 100).toFixed(1)}%`,
            icon: CheckCircle2,
            detail: `${metrics?.successes ?? 0} successful requests`,
          },
          {
            label: "Reported tokens",
            value:
              metrics?.input_tokens == null
                ? "—"
                : (
                    (metrics.input_tokens || 0) + (metrics.output_tokens || 0)
                  ).toLocaleString(),
            icon: Coins,
            detail: `SDK usage on ${metrics?.token_measured_requests ?? 0} requests`,
          },
        ].map((item) => (
          <div className="panel metric" key={item.label}>
            <div>
              <span>{item.label}</span>
              <item.icon size={18} />
            </div>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
      <div className="panel chart-panel">
        <div className="panel-header">
          <h3>Request latency</h3>
          <span className="muted small">
            Most recent 50 requests · oldest first
          </span>
        </div>
        {traces.length ? (
          <div className="bar-chart">
            {[...traces].reverse().map((t) => (
              <div
                key={t.id}
                className={t.success ? "bar" : "bar failed"}
                style={{
                  height: `${Math.max(3, (t.latency_ms / max) * 100)}%`,
                }}
                title={`${t.route} · ${latency(t.latency_ms)} · ${t.success ? "success" : t.error_category}`}
              />
            ))}
          </div>
        ) : (
          <div className="empty">
            <Activity size={28} />
            <p>Complete your first request to see latency data.</p>
          </div>
        )}
      </div>
      <div className="panel traces">
        <div className="panel-header">
          <h3>Recent traces</h3>
          <span className="badge">
            <ArrowUpRight size={12} />
            Live records
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Trace / session</th>
                <th>Route</th>
                <th>Status</th>
                <th>Total / model</th>
                <th>Nodes</th>
                <th>Tokens in / out</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr key={t.id}>
                  <td>
                    <code title={t.id}>{t.id.slice(0, 8)}</code>
                    <small>{t.session_ref || "—"}</small>
                  </td>
                  <td>{t.route}</td>
                  <td>
                    <span
                      className={`badge ${t.success ? "success" : "failure"}`}
                    >
                      {t.success ? "Success" : t.error_category}
                    </span>
                  </td>
                  <td>
                    {latency(t.latency_ms)}
                    <small>{latency(t.model_latency_ms)} model</small>
                    {t.retrieval_latency_ms !== null && (
                      <small>{latency(t.retrieval_latency_ms)} retrieval</small>
                    )}
                  </td>
                  <td>{t.nodes}</td>
                  <td>
                    {t.input_tokens ?? "—"} / {t.output_tokens ?? "—"}
                  </td>
                  <td>{new Date(t.started_at).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!traces.length && (
          <p className="muted small table-empty">
            No traces yet. Requests that fail in a workflow are recorded too.
          </p>
        )}
      </div>
      <p className="small muted">
        Token counts come from the SDK; unavailable counts are shown as —.
        End-to-end workflow time includes graph execution and persistence.
        Transcription requests are included. HTTP validation, document uploads
        and list requests are not included. Metrics are local single-user
        operational data.
      </p>
    </>
  );
}
