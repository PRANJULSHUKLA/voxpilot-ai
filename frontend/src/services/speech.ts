import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { BrowserRecorder, recordingMime } from "./recorder";
import { BrowserSynthesis } from "./synthesis";
import type { AudioStatus, Transcript } from "../types";
export type VoiceState =
  | "idle"
  | "requesting_permission"
  | "listening"
  | "stopping_recording"
  | "transcribing"
  | "transcript_ready"
  | "thinking"
  | "speaking"
  | "error";
const transitions: Record<VoiceState, VoiceState[]> = {
  idle: [
    "requesting_permission",
    "thinking",
    "speaking",
    "error",
    "transcript_ready",
  ],
  requesting_permission: ["listening", "idle", "error"],
  listening: ["stopping_recording", "idle", "error"],
  stopping_recording: ["transcribing", "idle", "error"],
  transcribing: ["transcript_ready", "idle", "error"],
  transcript_ready: [
    "thinking",
    "requesting_permission",
    "idle",
    "speaking",
    "error",
  ],
  thinking: ["speaking", "idle", "error"],
  speaking: ["idle", "requesting_permission", "thinking", "error"],
  error: [
    "idle",
    "requesting_permission",
    "thinking",
    "transcript_ready",
    "speaking",
  ],
};
export const canTransition = (from: VoiceState, to: VoiceState) =>
  from === to || transitions[from].includes(to);
export function useSpeech(
  onTranscript: (text: string) => Promise<void> | void,
  onError: (message: string) => void,
) {
  const finalRef = useRef(onTranscript),
    errorRef = useRef(onError);
  finalRef.current = onTranscript;
  errorRef.current = onError;
  const recorder = useRef(new BrowserRecorder()),
    synthesis = useRef(new BrowserSynthesis());
  const phase = useRef<VoiceState>("idle"),
    [state, setState] = useState<VoiceState>("idle");
  const [level, setLevel] = useState(0),
    [meterAvailable, setMeter] = useState(false),
    [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null),
    [lastTranscript, setLastTranscript] = useState<Transcript | null>(null),
    [recordingSeconds, setRecordingSeconds] = useState(0),
    [totalTurnMs, setTotalTurnMs] = useState<number | null>(null);
  const request = useRef<AbortController | null>(null),
    epoch = useRef(0),
    turnStart = useRef(0),
    timer = useRef<ReturnType<typeof setInterval> | null>(null),
    stopRef = useRef<() => void>(() => {});
  const transition = (next: VoiceState) => {
    if (canTransition(phase.current, next)) {
      phase.current = next;
      setState(next);
    }
  };
  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  const refreshAudioStatus = async () => {
    try {
      setAudioStatus(await api<AudioStatus>("/audio/status"));
    } catch {
      /* API connection errors are shown by the main workspace. */
    }
  };
  useEffect(() => {
    let active = true;
    const update = () => {
      if (active)
        setVoices(
          "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [],
        );
    };
    update();
    window.speechSynthesis?.addEventListener("voiceschanged", update);
    void refreshAudioStatus();
    const r = recorder.current,
      s = synthesis.current;
    return () => {
      active = false;
      epoch.current++;
      r.cancel();
      s.stop();
      request.current?.abort();
      clearTimer();
      window.speechSynthesis?.removeEventListener("voiceschanged", update);
    };
  }, []);
  const stopSpeech = () => {
    synthesis.current.stop();
    if (phase.current === "speaking") {
      setTotalTurnMs(
        turnStart.current ? performance.now() - turnStart.current : null,
      );
      transition("idle");
    }
  };
  const cancel = () => {
    epoch.current++;
    clearTimer();
    recorder.current.cancel();
    request.current?.abort();
    request.current = null;
    synthesis.current.stop();
    setLevel(0);
    transition("idle");
  };
  const fail = (error: unknown) => {
    transition("error");
    errorRef.current(
      error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission denied. Enable microphone access in browser site settings."
        : error instanceof DOMException && error.name === "NotFoundError"
          ? "No microphone found. Connect an input device or use text."
          : error instanceof Error
            ? error.message
            : "Voice input failed. Retry or use text.",
    );
  };
  const startListening = async () => {
    if (
      !["idle", "transcript_ready", "error", "speaking"].includes(phase.current)
    )
      return;
    synthesis.current.stop();
    errorRef.current("");
    transition("requesting_permission");
    const current = ++epoch.current;
    turnStart.current = performance.now();
    setTotalTurnMs(null);
    setRecordingSeconds(0);
    setLevel(0);
    try {
      await recorder.current.start(
        setLevel,
        setMeter,
        (message) => {
          clearTimer();
          fail(new Error(message));
        },
        audioStatus?.max_upload_bytes || 10485760,
      );
      if (current !== epoch.current) return;
      transition("listening");
      const start = performance.now();
      timer.current = setInterval(() => {
        const seconds = (performance.now() - start) / 1000;
        setRecordingSeconds(seconds);
        if (seconds >= (audioStatus?.max_duration_seconds || 60) - 0.5)
          stopRef.current();
      }, 100);
    } catch (error) {
      if (current === epoch.current) fail(error);
    }
  };
  const stopListening = async () => {
    if (phase.current !== "listening") return;
    transition("stopping_recording");
    clearTimer();
    const current = epoch.current;
    try {
      const recording = await recorder.current.stop();
      setLevel(0);
      if (current !== epoch.current) return;
      setRecordingSeconds(recording.durationSeconds);
      transition("transcribing");
      request.current = new AbortController();
      const form = new FormData();
      form.append("file", recording.blob, "recording");
      const polling = setInterval(() => void refreshAudioStatus(), 1500);
      let response: Transcript;
      try {
        response = await api<Transcript>(
          "/audio/transcribe",
          { method: "POST", body: form, signal: request.current.signal },
          300000,
        );
      } finally {
        clearInterval(polling);
      }
      if (current !== epoch.current) return;
      request.current = null;
      setLastTranscript(response);
      transition("transcript_ready");
      await refreshAudioStatus();
      if (current !== epoch.current) return;
      await finalRef.current(response.transcript);
      if (
        current === epoch.current &&
        (phase.current as VoiceState) === "transcript_ready"
      )
        setTotalTurnMs(performance.now() - turnStart.current);
    } catch (error) {
      if (current === epoch.current) fail(error);
    } finally {
      void refreshAudioStatus();
    }
  };
  stopRef.current = () => {
    void stopListening();
  };
  const play = (text: string, voice: string, rate: number) => {
    if (
      [
        "listening",
        "requesting_permission",
        "transcribing",
        "stopping_recording",
      ].includes(phase.current)
    )
      return;
    synthesis.current.stop();
    transition("speaking");
    synthesis.current.play(
      text,
      voice,
      rate,
      () => {
        if (phase.current === "speaking") {
          setTotalTurnMs(
            turnStart.current ? performance.now() - turnStart.current : null,
          );
          transition("idle");
        }
      },
      () =>
        fail(
          new Error(
            "Audio playback unavailable. Your text response is still available.",
          ),
        ),
    );
  };
  const prepare = async () => {
    request.current = new AbortController();
    try {
      const pending = api<AudioStatus>(
        "/audio/prepare",
        { method: "POST", signal: request.current.signal },
        300000,
      );
      setAudioStatus((previous) =>
        previous ? { ...previous, state: "loading" } : previous,
      );
      const interval = setInterval(() => void refreshAudioStatus(), 1500);
      try {
        setAudioStatus(await pending);
      } finally {
        clearInterval(interval);
      }
    } catch (error) {
      fail(error);
      void refreshAudioStatus();
    } finally {
      request.current = null;
    }
  };
  return {
    state,
    listening: state === "listening",
    speaking: state === "speaking",
    interim: "",
    voices,
    supported: !!recordingMime() && !!navigator.mediaDevices?.getUserMedia,
    startListening,
    stopListening,
    stopSpeech,
    cancel,
    play,
    level,
    meterAvailable,
    audioStatus,
    lastTranscript,
    recordingSeconds,
    totalTurnMs,
    prepare,
    refreshAudioStatus,
    startThinking: () => {
      if (phase.current !== "transcript_ready") {
        turnStart.current = performance.now();
        setTotalTurnMs(null);
      }
      transition("thinking");
    },
    finishThinking: () => {
      if (phase.current === "thinking") {
        setTotalTurnMs(
          turnStart.current ? performance.now() - turnStart.current : null,
        );
        transition("idle");
      }
    },
    markError: (message: string) => fail(new Error(message)),
  };
}
