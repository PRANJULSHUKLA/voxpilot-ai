import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  AudioLines,
  BookOpen,
  ChevronRight,
  FileText,
  Settings2,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react";
import { ChatWorkspace } from "./features/ChatWorkspace";
import { api, ApiError, json } from "./services/api";
import { useSpeech } from "./services/speech";
import { SettingsScreen } from "./features/Settings";
import { stored, store } from "./services/preferences";
import { Composer } from "./components/Composer";
import { Meetings } from "./features/Meetings";
import { Documents } from "./features/Documents";
import { Observability } from "./features/Observability";
import type { Answer, Config, Message, Mode, Session } from "./types";
const navigation = [
  { name: "Voice Assistant", icon: AudioLines },
  { name: "Meeting Intelligence", icon: FileText },
  { name: "Knowledge", icon: BookOpen },
  { name: "Observability", icon: Activity },
  { name: "Settings", icon: Settings2 },
] as const;
export default function App() {
  const [mode, setMode] = useState<Mode>("Voice Assistant"),
    [config, setConfig] = useState<Config | null>(null);
  const [session, setSession] = useState<Session | null>(null),
    [sessions, setSessions] = useState<Session[]>([]),
    [messages, setMessages] = useState<Message[]>([]);
  const [meeting, setMeeting] = useState<Session | null>(null),
    [draft, setDraft] = useState(""),
    [requestBusy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [selectedDoc, setSelectedDoc] = useState(""),
    [documentAnswer, setDocumentAnswer] = useState<Answer | null>(null);
  const [spoken, setSpoken] = useState(stored("vox-spoken", "true") === "true"),
    [voice, setVoice] = useState(stored("vox-voice")),
    [rate, setRate] = useState(Number(stored("vox-rate", "1")));
  const controller = useRef<AbortController | null>(null),
    inflight = useRef(false);
  const interrupted = useRef(false);
  const [autoSend, setAutoSend] = useState(
    stored("vox-auto-send", "true") === "true",
  );
  const [lastModelMs, setLastModelMs] = useState<number | null>(null);
  const transcriptHandler = useRef<(text: string) => Promise<void>>(
    async () => {},
  );
  const speech = useSpeech((text) => transcriptHandler.current(text), setError);
  const busy =
    requestBusy ||
    [
      "requesting_permission",
      "listening",
      "stopping_recording",
      "transcribing",
    ].includes(speech.state);
  const fail = (e: unknown) => {
    const message =
      e instanceof ApiError
        ? `${e.message}${e.traceId ? ` (Trace ${e.traceId})` : ""}`
        : e instanceof Error
          ? e.message
          : "Something went wrong.";
    setError(message);
    speech.markError(message);
  };
  const perform = async (fn: () => Promise<void>) => {
    if (inflight.current) return;
    inflight.current = true;
    interrupted.current = false;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (interrupted.current)
        setError(
          "Request cancelled in this browser. Gemini may still finish on the server; refresh before retrying.",
        );
      else fail(e);
    } finally {
      setBusy(false);
      inflight.current = false;
    }
  };
  const fetchMessages = async (id: string) => {
    // Fetch each API page so long conversations remain visible after refresh.
    const all: Message[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await api<Message[]>(
        `/sessions/${id}/messages?offset=${offset}&limit=200`,
      );
      all.push(...page);
      if (page.length < 200) break;
    }
    setMessages(all);
  };
  const fetchSessions = async () =>
    setSessions(await api<Session[]>("/sessions"));
  const selectSession = async (s: Session) => {
    if (new Date(s.expires_at) <= new Date()) {
      setSession(s);
      setMessages([]);
      setSelectedDoc("");
      setDocumentAnswer(null);
      setError(
        "This conversation expired. Use Clear conversation to delete it, or start a new conversation.",
      );
      return;
    }
    const current = await api<Session>(`/sessions/${s.id}`);
    await fetchMessages(s.id);
    setSession(current);
    store("vox-session", s.id);
    setSelectedDoc("");
    setDocumentAnswer(null);
  };
  const newSession = async () => {
    const current = await api<Session>("/sessions", {
      method: "POST",
      body: json({ title: "New conversation" }),
    });
    setSession(current);
    setMessages([]);
    setDraft("");
    store("vox-session", current.id);
    setSelectedDoc("");
    setDocumentAnswer(null);
    await fetchSessions();
  };
  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const [configuration, list] = await Promise.all([
          api<Config>("/config/status"),
          api<Session[]>("/sessions"),
        ]);
        if (!active) return;
        setConfig(configuration);
        setSessions(list);
        const previous = stored("vox-session");
        const found = list.find(
          (s) => s.id === previous && new Date(s.expires_at) > new Date(),
        );
        if (found) await selectSession(found);
        // Creation stays behind a user action to avoid duplicate sessions in Strict Mode.
      } catch (e) {
        if (active) fail(e);
      }
    };
    void initialize();
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, []);
  const changeMode = (next: Mode) => {
    speech.cancel();
    setDraft("");
    setMode(next);
    setError("");
  };
  const stopAll = () => {
    interrupted.current = true;
    speech.cancel();
    controller.current?.abort();
  };
  const submitText = (input: string) =>
    perform(async () => {
      const text = input.trim();
      if (!text) return;
      speech.stopSpeech();
      if (mode === "Meeting Intelligence") {
        if (!meeting) return;
        setMeeting(
          await api<Session>(`/meetings/${meeting.id}/transcript`, {
            method: "POST",
            body: json({ text }),
          }),
        );
        setDraft("");
        return;
      }
      speech.startThinking();
      let current = session;
      if (!current) {
        current = await api<Session>("/sessions", {
          method: "POST",
          body: json({ title: text.slice(0, 70) }),
        });
        setSession(current);
        store("vox-session", current.id);
        await fetchSessions();
      }
      if (interrupted.current) {
        speech.finishThinking();
        return;
      }
      controller.current = new AbortController();
      try {
        const path =
          mode === "Knowledge" ? `/documents/${selectedDoc}/ask` : "/chat";
        const result = await api<Answer>(
          path,
          {
            method: "POST",
            body: json({ text, session_id: current.id }),
            signal: controller.current.signal,
          },
          (config?.request_timeout_seconds || 45) * 1000 + 10000,
        );
        if (controller.current.signal.aborted) return;
        setLastModelMs(result.model_latency_ms ?? null);
        setDraft("");
        if (mode === "Knowledge") setDocumentAnswer(result);
        // The response is already committed. Keep it visible even if reloading fails.
        const created_at = new Date().toISOString();
        setMessages((previous) => [
          ...previous,
          {
            id: `${result.trace_id}-user`,
            role: "user",
            content: text,
            created_at,
          },
          {
            id: `${result.trace_id}-assistant`,
            role: "assistant",
            content: result.answer,
            created_at,
          },
        ]);
        if (!controller.current.signal.aborted && spoken)
          speech.play(result.answer, voice, rate);
        try {
          await fetchMessages(current.id);
        } catch {
          setError(
            "Response saved, but conversation refresh failed. Refresh the conversation before retrying your message.",
          );
        }
      } finally {
        controller.current = null;
        speech.finishThinking();
      }
    });
  const submit = () => submitText(draft);
  transcriptHandler.current = async (text) => {
    setLastModelMs(null);
    setDraft(text);
    if (
      autoSend &&
      (mode === "Meeting Intelligence" ||
        (config?.configured && (mode !== "Knowledge" || selectedDoc)))
    )
      await submitText(text);
    else if (autoSend && !config?.configured)
      setError(
        "Transcription succeeded locally. Add a Gemini key to generate a response, or keep editing the transcript.",
      );
  };
  const composer = (
    <Composer
      text={draft}
      setText={setDraft}
      listening={speech.listening}
      interim={speech.interim}
      supported={speech.supported}
      busy={busy}
      disabled={
        mode === "Meeting Intelligence"
          ? !meeting
          : !config?.configured ||
            (mode === "Knowledge" && !selectedDoc) ||
            (!!session && new Date(session.expires_at) <= new Date())
      }
      onListen={() => {
        setError("");
        void speech.startListening();
      }}
      onStop={speech.stopListening}
      onSubmit={submit}
      maxLength={config?.max_input_characters || 12000}
      label={
        mode === "Meeting Intelligence"
          ? "Add transcript"
          : mode === "Knowledge"
            ? "Ask document"
            : "Send message"
      }
    />
  );
  return (
    <div className="app-shell cosmic-shell">
      <div className="cosmic-sky" aria-hidden="true" />
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            if (!busy) changeMode("Voice Assistant");
          }}
        >
          <div className="brand-icon">
            <AudioLines size={24} />
          </div>
          <span>
            voxpilot<span className="brand-ai">AI</span>
          </span>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            Your space<small>VOICE & KNOWLEDGE</small>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              disabled={busy}
              key={item.name}
              className={mode === item.name ? "nav-item selected" : "nav-item"}
              aria-current={mode === item.name ? "page" : undefined}
              onClick={() => changeMode(item.name)}
            >
              <item.icon size={19} />
              {item.name}
              {mode === item.name && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card">
            <ShieldCheck size={19} />
            <h4>Your voice. Your control.</h4>
            <p>
              Local transcription. Optional review. Always under your control.
            </p>
            <button onClick={() => changeMode("Settings")} disabled={busy}>
              Privacy & settings <ArrowRight size={14} />
            </button>
          </div>
          <div className="sidebar-foot">
            <span className="tiny-dot" />
            Local workspace<span>v1.0</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{mode}</strong>
          </div>
          <div className="topbar-right">
            <span className="stt-readiness">
              <span
                className={`provider-dot ${speech.audioStatus?.ready ? "ready" : ""}`}
              />
              Local STT ·{" "}
              {speech.audioStatus?.state?.replaceAll("_", " ") || "unavailable"}
            </span>
            <span
              className={`provider-dot ${config?.configured ? "ready" : ""}`}
            />
            <span>
              {config?.configured
                ? "Gemini configured"
                : "Gemini not configured"}
            </span>
            <span className="avatar">VP</span>
          </div>
        </header>
        <div className="main-content">
          {!config?.configured && (
            <div className="setup-notice">
              <Zap size={18} />
              <div>
                <strong>Local listening is available.</strong> Add
                GEMINI_API_KEY to your .env file and restart the backend.{" "}
                <span>Speech recognition works without a key.</span>
              </div>
              <button onClick={() => changeMode("Settings")} disabled={busy}>
                Setup guide <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              {speech.state === "error" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (draft.trim() && config?.configured) void submit();
                    else void speech.startListening();
                  }}
                >
                  {draft.trim() && config?.configured
                    ? "Retry message"
                    : "Record again"}
                </button>
              )}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {mode === "Voice Assistant" && (
            <ChatWorkspace
              busy={busy}
              messages={messages}
              session={session}
              sessions={sessions}
              speech={speech}
              autoSend={autoSend}
              setAutoSend={setAutoSend}
              lastModelMs={lastModelMs}
              voice={voice}
              rate={rate}
              spoken={spoken}
              setSpoken={setSpoken}
              setDraft={setDraft}
              onNew={() => perform(newSession)}
              onClear={() =>
                perform(async () => {
                  if (session)
                    await api(`/sessions/${session.id}`, { method: "DELETE" });
                  await newSession();
                })
              }
              onRefresh={() =>
                perform(async () => {
                  if (session) await fetchMessages(session.id);
                })
              }
              onSelect={(chosen) => perform(() => selectSession(chosen))}
              onCancel={stopAll}
              stopAll={stopAll}
              changeMode={changeMode}
              composer={composer}
            />
          )}
          {mode === "Meeting Intelligence" && (
            <Meetings
              meeting={meeting}
              setMeeting={setMeeting}
              busy={busy}
              configured={!!config?.configured}
              perform={perform}
              composer={composer}
            />
          )}
          {mode === "Knowledge" && (
            <>
              {!session && (
                <div className="setup-notice">
                  Create a conversation to scope your documents.
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => perform(newSession)}
                  >
                    Create conversation
                  </button>
                </div>
              )}
              <Documents
                sessionId={session?.id || null}
                selected={selectedDoc}
                setSelected={(id) => {
                  setSelectedDoc(id);
                  setDocumentAnswer(null);
                }}
                answer={documentAnswer}
                busy={busy}
                configured={!!config?.configured}
                perform={perform}
                composer={composer}
              />
            </>
          )}
          {mode === "Observability" && (
            <Observability perform={perform} busy={busy} />
          )}
          {mode === "Settings" && (
            <SettingsScreen
              config={config}
              setConfig={setConfig}
              busy={busy}
              perform={perform}
              spoken={spoken}
              setSpoken={setSpoken}
              voice={voice}
              setVoice={setVoice}
              rate={rate}
              setRate={setRate}
              speech={speech}
              autoSend={autoSend}
              setAutoSend={setAutoSend}
            />
          )}
        </div>
        <footer className="main-footer">
          <span>VOXPILOT AI</span>
          <span>Made for your train of thought.</span>
        </footer>
      </main>
    </div>
  );
}
