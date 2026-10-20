import { AudioLines, Mic, Square, Radio, LoaderCircle } from "lucide-react";
import type { CSSProperties } from "react";
import type { useSpeech } from "../services/speech";
import { store } from "../services/preferences";
type Props = {
  speech: ReturnType<typeof useSpeech>;
  busy: boolean;
  autoSend: boolean;
  setAutoSend: (value: boolean) => void;
  stopAll: () => void;
  lastModelMs: number | null;
};
export const voiceLabels = {
  idle: "Ready when you are",
  requesting_permission: "Allow microphone access",
  listening: "Listening to your universe",
  stopping_recording: "Finishing your recording",
  transcribing: "Transcribing your voice",
  transcript_ready: "Your words, captured",
  thinking: "Connecting the constellations",
  speaking: "A response, resonating",
  error: "Let’s reconnect",
};
export function CosmicOrb({
  speech,
  busy,
  autoSend,
  setAutoSend,
  stopAll,
  lastModelMs,
}: Props) {
  const recording = speech.state === "listening",
    loading = [
      "requesting_permission",
      "stopping_recording",
      "transcribing",
      "thinking",
    ].includes(speech.state);
  return (
    <section
      className={`panel voice-stage celestial-stage state-${speech.state}`}
      aria-label="Voice interaction"
    >
      <div className="stage-top">
        <span className="badge">
          <Radio size={12} />
          LOCAL VOICE · FASTER-WHISPER
        </span>
        <span className={`interaction-status ${speech.state}`} role="status">
          {speech.state.replaceAll("_", " ")}
        </span>
      </div>
      <div
        className="celestial-system"
        style={{ "--mic-level": speech.level } as CSSProperties}
      >
        <div className="orb-grid" />
        <div className="celestial-orbit orbit-a" />
        <div className="celestial-orbit orbit-b" />
        <div className="celestial-orbit orbit-c" />
        <span className="satellite satellite-a" />
        <span className="satellite satellite-b" />
        <span className="coordinate coordinate-left">VOX / 01</span>
        <span className="coordinate coordinate-right">SIGNAL · LOCAL</span>
        <button
          className="celestial-core"
          aria-label={
            recording
              ? "Stop recording and transcribe"
              : "Talk to VoxPilot — start recording"
          }
          disabled={
            loading || (!speech.supported && !recording) || (busy && !recording)
          }
          onClick={() => {
            if (recording) void speech.stopListening();
            else void speech.startListening();
          }}
        >
          <span className="core-halo" />
          <span className="core-body">
            <span className="core-ribbon" />
            {loading ? (
              <LoaderCircle className="core-symbol spin" size={31} />
            ) : recording ? (
              <AudioLines className="core-symbol" size={34} />
            ) : (
              <Mic className="core-symbol" size={31} />
            )}
          </span>
        </button>
      </div>
      <div className="orb-caption">
        <span className="eyebrow">
          {recording
            ? "YOUR MICROPHONE IS LIVE"
            : speech.state === "transcribing"
              ? "AUDIO → WORDS"
              : speech.state === "thinking"
                ? "WORDS → POSSIBILITY"
                : "AN OPEN CHANNEL TO YOUR NEXT IDEA"}
        </span>
        <h2>{voiceLabels[speech.state]}</h2>
        <p>
          {recording
            ? "Speak naturally. Stop when your thought is complete."
            : speech.state === "transcribing"
              ? speech.audioStatus?.state === "loading"
                ? "Downloading the local model on first use. This may take a few minutes."
                : "Recognizing speech on your local backend. No Gemini quota used."
              : speech.state === "error"
                ? "Check the error above, then retry or continue with text."
                : speech.state === "thinking"
                  ? "Gemini is working with your conversation context."
                  : "One thought can open up an entire universe."}
        </p>
      </div>
      <div className="stage-buttons">
        <button
          className="primary talk-action"
          aria-label={
            recording ? "Stop recording and transcribe" : "Talk to VoxPilot"
          }
          disabled={(busy && !recording) || loading || !speech.supported}
          onClick={() =>
            recording
              ? void speech.stopListening()
              : void speech.startListening()
          }
        >
          {recording ? <Square size={15} /> : <Mic size={16} />}{" "}
          {recording ? "Stop & transcribe" : "Talk to VoxPilot"}{" "}
          {!recording && (
            <span className="shortcut" aria-hidden="true">
              MIC
            </span>
          )}
        </button>
        <button
          className="secondary"
          disabled={speech.state === "idle" && !busy}
          onClick={stopAll}
        >
          <Square size={13} />
          {speech.speaking ? "Stop speaking" : "Interrupt"}
        </button>
      </div>
      <div className="signal-strip">
        <div className="live-level">
          <span className={`signal-dot ${recording ? "active" : ""}`} />
          {recording && speech.meterAvailable ? (
            <>
              <span>MIC LEVEL</span>
              <div className="level-track">
                <span style={{ width: `${speech.level * 100}%` }} />
              </div>
              <span>{Math.round(speech.level * 100)}%</span>
            </>
          ) : (
            <span>
              {recording
                ? "Recording · amplitude meter unavailable"
                : "Microphone off"}
            </span>
          )}
        </div>
        <span>
          {speech.recordingSeconds.toFixed(1)} s /{" "}
          {speech.audioStatus?.max_duration_seconds || 60} s
        </span>
      </div>
      <div className="voice-preferences">
        <label>
          <input
            type="checkbox"
            checked={autoSend}
            onChange={(e) => {
              setAutoSend(e.target.checked);
              store("vox-auto-send", String(e.target.checked));
            }}
          />
          Send transcript automatically
        </label>
        <span>
          {autoSend
            ? "Stop → transcribe → ask"
            : "Review & edit before sending"}
        </span>
      </div>
      {speech.lastTranscript && (
        <div className="last-capture">
          <span className="eyebrow">
            LAST CAPTURE · {speech.lastTranscript.language.toUpperCase()}
          </span>
          <p>{speech.lastTranscript.transcript}</p>
          <div className="turn-metrics">
            <span>
              STT{" "}
              {(speech.lastTranscript.transcription_latency_ms / 1000).toFixed(
                2,
              )}{" "}
              s
            </span>
            <span>
              Gemini{" "}
              {lastModelMs === null
                ? "—"
                : `${(lastModelMs / 1000).toFixed(2)} s`}
            </span>
            <span>
              Latest turn{" "}
              {speech.totalTurnMs === null
                ? "—"
                : `${(speech.totalTurnMs / 1000).toFixed(2)} s`}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
