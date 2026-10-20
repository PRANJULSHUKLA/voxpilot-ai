// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserRecorder, recordingMime } from "./recorder";
import { BrowserSynthesis } from "./synthesis";
import { canTransition } from "./speech";
let current: any,
  now = 0;
const stopTrack = vi.fn();
class Recorder {
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstop: any;
  ondataavailable: any;
  onerror: any;
  constructor() {
    current = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(["valid audio bytes"], { type: this.mimeType }),
      });
      this.onstop?.();
    });
  }
}
beforeEach(() => {
  now = 0;
  stopTrack.mockClear();
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("records a binary Blob, selects a supported MIME and releases the microphone", async () => {
  const recorder = new BrowserRecorder();
  await recorder.start(vi.fn(), vi.fn(), vi.fn(), 100000);
  now = 1500;
  const result = await recorder.stop();
  expect(result.blob.size).toBeGreaterThan(0);
  expect(result.blob.type).toBe("audio/webm;codecs=opus");
  expect(result.durationSeconds).toBe(1.5);
  expect(stopTrack).toHaveBeenCalled();
});
it("rejects unsupported recording formats before requesting permission", async () => {
  vi.stubGlobal(
    "MediaRecorder",
    class {
      static isTypeSupported = () => false;
    },
  );
  expect(recordingMime()).toBeNull();
  await expect(
    new BrowserRecorder().start(vi.fn(), vi.fn(), vi.fn(), 100),
  ).rejects.toThrow("no supported audio recording format");
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});
it("propagates permission denial", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(
    new DOMException("Denied", "NotAllowedError"),
  );
  await expect(
    new BrowserRecorder().start(vi.fn(), vi.fn(), vi.fn(), 100),
  ).rejects.toMatchObject({ name: "NotAllowedError" });
});
it("releases a microphone granted after permission was cancelled", async () => {
  let grant: ((x: any) => void) | undefined;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const r = new BrowserRecorder(),
    pending = r.start(vi.fn(), vi.fn(), vi.fn(), 100);
  r.cancel();
  grant!({ getTracks: () => [{ stop: stopTrack }] });
  await pending;
  expect(stopTrack).toHaveBeenCalledOnce();
});
it("rejects an empty recording", async () => {
  const r = new BrowserRecorder();
  await r.start(vi.fn(), vi.fn(), vi.fn(), 100);
  now = 1000;
  current.stop = function () {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  };
  await expect(r.stop()).rejects.toThrow("empty");
});
it("rejects excessively short recordings", async () => {
  const r = new BrowserRecorder();
  await r.start(vi.fn(), vi.fn(), vi.fn(), 100);
  now = 100;
  await expect(r.stop()).rejects.toThrow("too short");
});
it("stops playback without reporting interruption as audio failure", () => {
  let utterance: any;
  const cancel = vi.fn(),
    error = vi.fn();
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      onend: any;
      onerror: any;
      constructor(public text: string) {
        utterance = this;
      }
    },
  );
  vi.stubGlobal("speechSynthesis", {
    cancel,
    speak: vi.fn(),
    getVoices: () => [],
  });
  const s = new BrowserSynthesis();
  s.play("answer", "", 1, vi.fn(), error);
  s.stop();
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(utterance.onerror).toBeNull();
  expect(error).not.toHaveBeenCalled();
});
it("prevents invalid voice-state transitions", () => {
  expect(canTransition("idle", "listening")).toBe(false);
  expect(canTransition("listening", "thinking")).toBe(false);
  expect(canTransition("listening", "stopping_recording")).toBe(true);
  expect(canTransition("transcribing", "transcript_ready")).toBe(true);
});
it("aborts and releases tracks if recorded bytes exceed the limit", async () => {
  const error = vi.fn(),
    r = new BrowserRecorder();
  await r.start(vi.fn(), vi.fn(), error, 5);
  current.ondataavailable({ data: new Blob(["too many bytes"]) });
  expect(error).toHaveBeenCalledWith(expect.stringContaining("upload limit"));
  expect(stopTrack).toHaveBeenCalled();
  expect(current.state).toBe("inactive");
});
