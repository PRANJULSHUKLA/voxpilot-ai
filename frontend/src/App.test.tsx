// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  speak: vi.fn(),
}));
vi.mock("./services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/api")>();
  return { ...actual, api: mocks.api };
});
vi.mock("./services/recorder", () => ({
  recordingMime: () => "audio/webm",
  BrowserRecorder: class {
    start = mocks.start;
    stop = mocks.stop;
    cancel = mocks.cancel;
  },
}));
import App from "./App";
beforeEach(() => {
  localStorage.clear();
  mocks.api.mockReset();
  mocks.start.mockReset();
  mocks.stop.mockReset();
  mocks.speak.mockReset();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      onend: any;
      onerror: any;
      constructor(public text: string) {}
    },
  );
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [],
    speak: mocks.speak,
    cancel: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  mocks.start.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue({
    blob: new Blob(["audio"], { type: "audio/webm" }),
    durationSeconds: 2,
  });
  mocks.api.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/config/status")
      return {
        configured: true,
        model: "gemini-2.5-flash",
        max_input_characters: 12000,
        request_timeout_seconds: 45,
      };
    if (path === "/audio/status")
      return {
        model: "base",
        ready: true,
        state: "ready",
        max_duration_seconds: 60,
      };
    if (path === "/audio/transcribe")
      return {
        transcript: "Explain a black hole",
        language: "en",
        duration_seconds: 2,
        transcription_latency_ms: 15,
      };
    if (path === "/sessions" && options?.method === "POST")
      return { id: "session", title: "Voice test", expires_at: "2099-01-01" };
    if (path === "/sessions") return [];
    if (path === "/chat")
      return {
        answer: "A black hole is a region of spacetime.",
        trace_id: "trace",
        model_latency_ms: 25,
      };
    if (path.includes("/messages"))
      return [
        {
          id: "1",
          role: "user",
          content: "Explain a black hole",
          created_at: "2026-10-20",
        },
        {
          id: "2",
          role: "assistant",
          content: "A black hole is a region of spacetime.",
          created_at: "2026-10-20",
        },
      ];
    throw new Error(`Unexpected endpoint ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function record() {
  await waitFor(() =>
    expect(screen.getByText("Gemini configured")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Talk to VoxPilot" }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", {
        name: "Stop recording and transcribe",
      })[0],
    ).toBeTruthy(),
  );
  fireEvent.click(
    screen.getAllByRole("button", { name: "Stop recording and transcribe" })[0],
  );
}
it("automatically submits the transcript, displays the answer and speaks only the answer", async () => {
  render(<App />);
  await record();
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
  const chat = mocks.api.mock.calls.find((c) => c[0] === "/chat");
  expect(JSON.parse(chat?.[1].body as string).text).toBe(
    "Explain a black hole",
  );
  expect(mocks.speak.mock.calls[0][0].text).toBe(
    "A black hole is a region of spacetime.",
  );
  expect(screen.getByRole("status")).toBeTruthy();
  act(() => mocks.speak.mock.calls[0][0].onend());
  await waitFor(() =>
    expect(screen.getByText("idle", { exact: true })).toBeTruthy(),
  );
});
it("allows reviewing and editing the transcript before manual submission", async () => {
  render(<App />);
  await waitFor(() =>
    expect(screen.getByText("Gemini configured")).toBeTruthy(),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Send transcript automatically" }),
  );
  await record();
  await waitFor(() =>
    expect(
      (
        screen.getByLabelText(
          "Review transcript or type a message",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Explain a black hole"),
  );
  expect(mocks.api.mock.calls.some((c) => c[0] === "/chat")).toBe(false);
  fireEvent.change(
    screen.getByLabelText("Review transcript or type a message"),
    { target: { value: "Explain an orbit" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(mocks.api.mock.calls.some((c) => c[0] === "/chat")).toBe(true),
  );
  const chat = mocks.api.mock.calls.find((c) => c[0] === "/chat");
  expect(JSON.parse(chat?.[1].body as string).text).toBe("Explain an orbit");
});
it("speaks a successful answer even when history refresh stalls", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, options?: RequestInit) =>
    path.includes("/messages")
      ? new Promise(() => {})
      : original(path, options),
  );
  render(<App />);
  await record();
  await waitFor(() => expect(mocks.speak).toHaveBeenCalledOnce());
  expect(mocks.speak.mock.calls[0][0].text).toContain("black hole");
});
it("does not mislabel a saved answer as failed when history refresh fails", async () => {
  const original = mocks.api.getMockImplementation()!;
  mocks.api.mockImplementation((path: string, options?: RequestInit) =>
    path.includes("/messages")
      ? Promise.reject(new Error("offline"))
      : original(path, options),
  );
  render(<App />);
  await record();
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Response saved"),
  );
  expect(mocks.speak).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
  expect(
    screen.getByText("A black hole is a region of spacetime."),
  ).toBeTruthy();
});
it("does not start generation after cancellation during session creation", async () => {
  const original = mocks.api.getMockImplementation()!;
  let resolveSession: ((value: any) => void) | undefined;
  mocks.api.mockImplementation((path: string, options?: RequestInit) =>
    path === "/sessions" && options?.method === "POST"
      ? new Promise((resolve) => {
          resolveSession = resolve;
        })
      : original(path, options),
  );
  render(<App />);
  await record();
  await waitFor(() => expect(resolveSession).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  await act(async () => {
    resolveSession!({
      id: "session",
      title: "Cancelled",
      expires_at: "2099-01-01",
    });
  });
  expect(mocks.api.mock.calls.some(([path]) => path === "/chat")).toBe(false);
  expect(mocks.speak).not.toHaveBeenCalled();
});
