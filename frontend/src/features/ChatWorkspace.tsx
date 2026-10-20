import { useEffect, useRef } from "react";
import {
  ArrowRight,
  AudioLines,
  Headphones,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { CosmicOrb } from "../components/CosmicOrb";
import ReactMarkdown from "react-markdown";
import { store } from "../services/preferences";
import type { useSpeech } from "../services/speech";
import type { Message, Mode, Session } from "../types";
type Props = {
  autoSend: boolean;
  setAutoSend: (value: boolean) => void;
  lastModelMs: number | null;
  busy: boolean;
  messages: Message[];
  session: Session | null;
  sessions: Session[];
  speech: ReturnType<typeof useSpeech>;
  voice: string;
  rate: number;
  spoken: boolean;
  setSpoken: (value: boolean) => void;
  setDraft: (value: string) => void;
  onNew: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onSelect: (session: Session) => void;
  onCancel: () => void;
  stopAll: () => void;
  changeMode: (mode: Mode) => void;
  composer: React.ReactNode;
};
export function ChatWorkspace({
  autoSend,
  setAutoSend,
  lastModelMs,
  busy,
  messages,
  session,
  sessions,
  speech,
  voice,
  rate,
  spoken,
  setSpoken,
  setDraft,
  onNew,
  onClear,
  onRefresh,
  onSelect,
  onCancel,
  stopAll,
  changeMode,
  composer,
}: Props) {
  const messageList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messageList.current)
      messageList.current.scrollTop = messageList.current.scrollHeight;
  }, [messages, busy]);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL SIGNAL IN THE COSMOS</span>
          <h1>
            A universe of ideas.
            <br />
            <span>One conversation away.</span>
          </h1>
          <p className="muted">
            Speak freely. Think expansively. Let your ideas find their orbit.
          </p>
        </div>
        <button className="secondary" disabled={busy} onClick={onNew}>
          <Plus size={16} />
          New conversation
        </button>
      </div>
      <div className="assistant-layout">
        <section className="conversation-column">
          <CosmicOrb
            speech={speech}
            busy={busy}
            autoSend={autoSend}
            setAutoSend={setAutoSend}
            stopAll={stopAll}
            lastModelMs={lastModelMs}
          />
          <div className="conversation-header">
            <h3>
              <MessageSquare size={17} />
              Conversation <span className="badge">{messages.length}</span>
            </h3>
            <div>
              <button
                className="icon-button"
                disabled={busy || !session}
                aria-label="Refresh conversation"
                onClick={onRefresh}
              >
                <RefreshCw size={15} />
              </button>
              <button
                className="icon-button danger"
                aria-label="Clear current conversation and its documents"
                disabled={busy || !session}
                onClick={onClear}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <div className="messages" ref={messageList} aria-live="polite">
            {messages.length === 0 && (
              <div className="conversation-empty">
                <div className="assistant-avatar">
                  <AudioLines size={17} />
                </div>
                <div>
                  <strong>A fresh space for your thoughts.</strong>
                  <p>
                    Ask a question, explore an idea, or work through something
                    together.
                  </p>
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div
                  className={
                    message.role === "user" ? "user-avatar" : "assistant-avatar"
                  }
                >
                  {message.role === "user" ? "You" : <AudioLines size={17} />}
                </div>
                <div className="message-body">
                  <div className="message-label">
                    {message.role === "user" ? "You" : "VoxPilot"}
                    <time>
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <div className="markdown">
                    <ReactMarkdown>{message.content}</ReactMarkdown>
                  </div>
                  {message.role === "assistant" && (
                    <div className="audio-controls">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          speech.play(message.content, voice, rate)
                        }
                      >
                        <Volume2 size={14} />
                        Play / Replay
                      </button>
                      <button
                        className="text-button"
                        onClick={speech.stopSpeech}
                      >
                        <Square size={12} />
                        Stop
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {speech.state === "thinking" && (
              <div className="processing">
                <span className="loading-dot" />
                Working through your request…{" "}
                <button className="text-button" onClick={onCancel}>
                  Cancel request
                </button>
              </div>
            )}
          </div>
          {composer}
          <p className="privacy-line">
            <ShieldCheck size={12} />
            Audio is transcribed locally on your backend and discarded.
            Auto-send transmits recognized text to Gemini when configured; turn
            it off to review first.
          </p>
        </section>
        <aside className="context-column">
          <div className="panel quick-start">
            <span className="cosmic-card-icon">✧</span>
            <span className="eyebrow">CHOOSE A CONSTELLATION</span>
            <h3>Explore a new direction</h3>
            {[
              "Help me understand a complex topic",
              "Brainstorm an idea with me",
              "Help me plan my day",
            ].map((text, i) => (
              <button disabled={busy} key={text} onClick={() => setDraft(text)}>
                <span className="prompt-number">0{i + 1}</span>
                <span>{text}</span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
          <div className="panel session-card">
            <div className="panel-header">
              <h3>Conversations</h3>
              <Headphones size={17} />
            </div>
            {sessions.length === 0 ? (
              <p className="muted small">
                Your conversations will be saved here. Send a message to begin.
              </p>
            ) : (
              <>
                <label className="sr-only" htmlFor="session-picker">
                  Saved conversation
                </label>
                <select
                  id="session-picker"
                  disabled={busy}
                  value={session?.id || ""}
                  onChange={(e) => {
                    const chosen = sessions.find(
                      (s) => s.id === e.target.value,
                    );
                    if (chosen) onSelect(chosen);
                  }}
                >
                  <option value="" disabled>
                    Select a conversation
                  </option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} · {new Date(s.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {session && (
                  <p className="small muted">
                    Saved locally in your database.
                    <br />
                    Expires {new Date(session.expires_at).toLocaleString()}.
                  </p>
                )}
              </>
            )}
            <label className="toggle-label">
              <span>
                <Volume2 size={16} />
                Spoken responses
              </span>
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
          </div>
          <div className="feature-note">
            <span className="badge">BEYOND CONVERSATION</span>
            <h3>Capture a little stardust.</h3>
            <p>
              Turn discussions into clear notes, or find answers in your own
              documents.
            </p>
            <button
              disabled={busy}
              className="text-button"
              onClick={() => changeMode("Meeting Intelligence")}
            >
              Explore meeting intelligence <ArrowRight size={14} />
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}
