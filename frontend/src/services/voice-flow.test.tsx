// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("./api", () => ({ api: mocks.api }));
vi.mock("./recorder", () => ({
  recordingMime: () => "audio/webm",
  BrowserRecorder: class {
    start = mocks.start;
    stop = mocks.stop;
    cancel = mocks.cancel;
  },
}));
import { useSpeech } from "./speech";
beforeEach(() => {
  mocks.api.mockReset();
  mocks.start.mockReset();
  mocks.stop.mockReset();
  mocks.cancel.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue({
    blob: new Blob(["audio"], { type: "audio/webm" }),
    durationSeconds: 1,
  });
  mocks.api.mockImplementation(async (path: string) =>
    path === "/audio/status"
      ? {
          model: "base",
          ready: true,
          state: "ready",
          max_upload_bytes: 100000,
          max_duration_seconds: 60,
        }
      : {
          transcript: "My project is Atlas",
          language: "en",
          provider: "faster-whisper",
          duration_seconds: 1,
          transcription_latency_ms: 12,
          trace_id: "trace",
        },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("transcribes once and hands final text to the submission callback", async () => {
  const final = vi.fn(),
    error = vi.fn();
  const { result } = renderHook(() => useSpeech(final, error));
  await act(() => result.current.startListening());
  expect(result.current.state).toBe("listening");
  await act(() => result.current.stopListening());
  expect(result.current.state).toBe("transcript_ready");
  expect(final).toHaveBeenCalledExactlyOnceWith("My project is Atlas");
  const sent = mocks.api.mock.calls.find((c) => c[0] === "/audio/transcribe");
  expect(sent?.[1].body).toBeInstanceOf(FormData);
  expect(error.mock.calls.every(([message]) => message === "")).toBe(true);
  await act(() => result.current.stopListening());
  expect(final).toHaveBeenCalledOnce();
});
it("shows permission errors and supports retry", async () => {
  mocks.start.mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  const error = vi.fn();
  const { result } = renderHook(() => useSpeech(vi.fn(), error));
  await act(() => result.current.startListening());
  expect(result.current.state).toBe("error");
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("permission denied"),
  );
  await act(() => result.current.startListening());
  expect(result.current.state).toBe("listening");
});
it("does not submit stale transcription after interruption", async () => {
  let resolve: ((x: any) => void) | undefined;
  mocks.api.mockImplementation((path: string) =>
    path === "/audio/transcribe"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve({ model: "base", state: "ready" }),
  );
  const final = vi.fn();
  const { result } = renderHook(() => useSpeech(final, vi.fn()));
  await act(() => result.current.startListening());
  let pending: Promise<void>;
  act(() => {
    pending = result.current.stopListening();
  });
  await waitFor(() => expect(resolve).toBeDefined());
  act(() => result.current.cancel());
  await act(async () => {
    resolve!({ transcript: "stale" });
    await pending;
  });
  expect(final).not.toHaveBeenCalled();
  expect(result.current.state).toBe("idle");
});
it("keeps the transcript available when the downstream response fails", async () => {
  const error = vi.fn();
  const { result } = renderHook(() =>
    useSpeech(async () => {
      throw new Error("Gemini unavailable");
    }, error),
  );
  await act(() => result.current.startListening());
  await act(() => result.current.stopListening());
  expect(result.current.state).toBe("error");
  expect(result.current.lastTranscript?.transcript).toContain("Atlas");
  expect(error).toHaveBeenCalledWith("Gemini unavailable");
});
it("delivers recognized text even when readiness polling never resolves", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, ...args: any[]) =>
    path === "/audio/status" ? new Promise(() => {}) : original(path, ...args),
  );
  const final = vi.fn();
  const { result } = renderHook(() => useSpeech(final, vi.fn()));
  await act(() => result.current.startListening());
  await act(() => result.current.stopListening());
  expect(final).toHaveBeenCalledExactlyOnceWith("My project is Atlas");
});
