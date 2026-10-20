import {
  Check,
  RefreshCw,
  ShieldCheck,
  Square,
  Volume2,
  Zap,
} from "lucide-react";
import { api } from "../services/api";
import { store } from "../services/preferences";
import type { useSpeech } from "../services/speech";
import type { Config } from "../types";
type Props = {
  autoSend: boolean;
  setAutoSend: (value: boolean) => void;
  config: Config | null;
  setConfig: (value: Config) => void;
  busy: boolean;
  perform: (fn: () => Promise<void>) => void;
  spoken: boolean;
  setSpoken: (value: boolean) => void;
  voice: string;
  setVoice: (value: string) => void;
  rate: number;
  setRate: (value: number) => void;
  speech: ReturnType<typeof useSpeech>;
};
export function SettingsScreen({
  autoSend,
  setAutoSend,
  config,
  setConfig,
  busy,
  perform,
  spoken,
  setSpoken,
  voice,
  setVoice,
  rate,
  setRate,
  speech,
}: Props) {
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>Workspace settings</h2>
          <p className="muted">
            A familiar voice. A clear connection. Your preferences.
          </p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel settings-panel">
          <h3>Local speech recognition</h3>
          <dl>
            <dt>Engine</dt>
            <dd>faster-whisper</dd>
            <dt>Model</dt>
            <dd>{speech.audioStatus?.model || "—"}</dd>
            <dt>Status</dt>
            <dd>{speech.audioStatus?.state || "Unavailable"}</dd>
            <dt>Device</dt>
            <dd>
              {speech.audioStatus?.device || "—"} ·{" "}
              {speech.audioStatus?.compute_type || "—"}
            </dd>
          </dl>
          <p className="small muted">
            First use downloads multilingual weights into a persistent cache.
            Speech recognition uses no Gemini key or quota.
          </p>
          <div className="stage-buttons">
            <button
              className="primary"
              disabled={busy || speech.audioStatus?.state === "loading"}
              onClick={() => perform(speech.prepare)}
            >
              {speech.audioStatus?.state === "loading"
                ? "Downloading / loading…"
                : "Prepare local model"}
            </button>
            <button
              className="secondary"
              onClick={() => void speech.refreshAudioStatus()}
            >
              Refresh status
            </button>
          </div>
          <label className="toggle-label">
            <span>Send recognized text automatically</span>
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(e) => {
                setAutoSend(e.target.checked);
                store("vox-auto-send", String(e.target.checked));
              }}
            />
          </label>
          <p className="small muted">
            Turn off to review and edit your transcript before submitting it.
            With no Gemini key, the transcript stays editable.
          </p>
        </section>
        <section className="panel settings-panel">
          <h3>
            <Zap size={18} />
            Model connection
          </h3>
          <dl>
            <dt>Provider</dt>
            <dd>Google Gemini</dd>
            <dt>Model</dt>
            <dd>
              <code>{config?.model || "Unavailable"}</code>
            </dd>
            <dt>Embeddings</dt>
            <dd>
              <code>{config?.embedding_model || "Unavailable"}</code>
            </dd>
            <dt>Readiness</dt>
            <dd>
              {config?.configured ? (
                <span className="badge success">
                  <Check size={13} />
                  Key configured · access unverified
                </span>
              ) : (
                <span className="badge failure">Key missing</span>
              )}
            </dd>
          </dl>
          <p className="small muted">{config?.notice}</p>
          <div className="code-note">
            Copy .env.example to .env, set GEMINI_API_KEY, then restart with{" "}
            <code>docker compose up -d --force-recreate backend</code>.
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              perform(async () =>
                setConfig(await api<Config>("/config/status")),
              )
            }
          >
            <RefreshCw size={15} />
            Check configuration
          </button>
          <p className="small muted">
            API keys stay on the server. They cannot be changed or viewed here.
          </p>
        </section>
        <section className="panel settings-panel">
          <h3>
            <Volume2 size={18} />
            Voice & playback
          </h3>
          <label className="toggle-label">
            <span>Automatically read responses</span>
            <input
              type="checkbox"
              checked={spoken}
              onChange={(e) => {
                setSpoken(e.target.checked);
                store("vox-spoken", String(e.target.checked));
                if (!e.target.checked) speech.stopSpeech();
              }}
            />
          </label>
          <label>
            System voice
            <select
              value={voice}
              onChange={(e) => {
                setVoice(e.target.value);
                store("vox-voice", e.target.value);
              }}
            >
              <option value="">System default</option>
              {speech.voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </label>
          <label>
            Speech rate <span className="badge">{rate.toFixed(1)}×</span>
            <input
              aria-label="Speech rate"
              type="range"
              min="0.6"
              max="1.6"
              step="0.1"
              value={rate}
              onChange={(e) => {
                setRate(Number(e.target.value));
                store("vox-rate", e.target.value);
              }}
            />
          </label>
          <div className="stage-buttons">
            <button
              className="secondary"
              onClick={() =>
                speech.play(
                  "Welcome to VoxPilot. A little less typing. A lot more thinking.",
                  voice,
                  rate,
                )
              }
            >
              <Volume2 size={15} />
              Preview voice
            </button>
            <button className="secondary" onClick={speech.stopSpeech}>
              <Square size={14} />
              Stop
            </button>
          </div>
          <p className="small muted">
            Available voices depend on your operating system and browser.
          </p>
        </section>
        <section className="panel settings-panel privacy-settings">
          <h3>
            <ShieldCheck size={18} />
            Privacy & control
          </h3>
          <p>
            Microphone permission is requested only when you start listening.
            MediaRecorder captures microphone audio; it is uploaded only to this
            application's backend for local faster-whisper recognition.
          </p>
          <p>
            This app uploads recorded audio to its backend, transcribes it in
            memory and discards it. It does not send audio to Gemini or an
            external transcription service. Recognized transcripts,
            conversations, notes, extracted document text and vectors are saved
            in your database. Submitted messages, relevant history, meeting
            transcripts and retrieved excerpts are sent to Gemini; document text
            is also sent for embeddings.
          </p>
          <p>
            Interrupt stops playback immediately. Cancelling a browser request
            does not guarantee cancellation of Gemini generation or server
            persistence. Refresh before retrying. Sessions expire after{" "}
            {config?.session_ttl_hours || 24} hours; expiry prevents further use
            but does not erase data. Delete a conversation to remove its
            messages and documents. Delete meetings separately. Operational
            traces retain only metadata for seven days by default.
          </p>
          <p>
            This local edition has no user authentication. Session identifiers
            are not credentials. Keep it bound to localhost; add authentication,
            authorization, TLS and deployment controls before sharing it.
          </p>
        </section>
      </div>
    </>
  );
}
