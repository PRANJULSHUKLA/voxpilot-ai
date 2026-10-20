import { Mic, Square, Send, X } from "lucide-react";
export function Composer({
  text,
  setText,
  listening,
  interim,
  supported,
  busy,
  disabled,
  onListen,
  onStop,
  onSubmit,
  maxLength,
  label = "Send message",
}: {
  text: string;
  setText: (s: string) => void;
  listening: boolean;
  interim: string;
  supported: boolean;
  busy: boolean;
  disabled: boolean;
  onListen: () => void;
  onStop: () => void;
  onSubmit: () => void;
  maxLength: number;
  label?: string;
}) {
  const overLimit = text.length > maxLength;
  return (
    <div className="composer">
      <label className="sr-only" htmlFor="message">
        Review transcript or type a message
      </label>
      <textarea
        id="message"
        value={text}
        maxLength={maxLength}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a thought, or use your voice…"
        rows={3}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (text.trim() && !busy && !disabled && !overLimit) {
              onStop();
              onSubmit();
            }
          }
        }}
      />
      {interim && (
        <p className="interim" aria-live="polite">
          Hearing: {interim}
        </p>
      )}
      <div className="composer-tools">
        <button
          className={listening ? "listen active" : "listen"}
          onClick={listening ? onStop : onListen}
          disabled={(busy && !listening) || !supported}
        >
          <Mic size={16} />
          {listening ? "Stop & transcribe" : "Record voice"}
        </button>
        <span className="composer-hint">
          {text.length.toLocaleString()} / {maxLength.toLocaleString()} · Review
          before sending
        </span>
        {text && (
          <button
            className="icon-button"
            aria-label="Discard draft"
            onClick={() => setText("")}
            disabled={busy}
          >
            <X size={17} />
          </button>
        )}
        <button
          className="primary send"
          aria-label={label}
          onClick={() => {
            onStop();
            onSubmit();
          }}
          disabled={!text.trim() || busy || disabled || overLimit}
        >
          {busy ? <Square size={16} /> : <Send size={16} />}
          <span>{label}</span>
        </button>
      </div>
      {overLimit && (
        <p className="small danger" role="alert">
          Your draft exceeds the input limit. Shorten it before sending; no
          speech has been discarded.
        </p>
      )}
      {!supported && (
        <p className="small muted">
          Audio recording is unavailable in this browser. Text input works
          normally.
        </p>
      )}
    </div>
  );
}
