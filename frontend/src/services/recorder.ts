export type Recording = { blob: Blob; durationSeconds: number };
export const recordingMime = () => {
  if (typeof MediaRecorder === "undefined") return null;
  return (
    [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || null
  );
};
export interface RecordingProvider {
  start(
    onLevel: (level: number) => void,
    onMeter: (available: boolean) => void,
    onError: (message: string) => void,
    maxBytes: number,
  ): Promise<void>;
  stop(): Promise<Recording>;
  cancel(): void;
}
export class BrowserRecorder implements RecordingProvider {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private frame = 0;
  private generation = 0;
  private chunks: Blob[] = [];
  private started = 0;
  private stopPromise: Promise<Recording> | null = null;
  private rejectStop: ((reason: Error) => void) | null = null;
  async start(
    onLevel: (level: number) => void,
    onMeter: (available: boolean) => void,
    onError: (message: string) => void,
    maxBytes: number,
  ) {
    if (this.recorder) throw new Error("A recording is already running.");
    const generation = ++this.generation;
    const mime = recordingMime();
    if (!mime)
      throw new Error(
        "This browser has no supported audio recording format. Use a current Chrome, Edge, Firefox or Safari, or type instead.",
      );
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Microphone access requires localhost or HTTPS.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.chunks = [];
    this.stopPromise = null;
    try {
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      this.recorder = recorder;
      let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          bytes += event.data.size;
          if (bytes > maxBytes) {
            this.cancel();
            onError(
              "Recording exceeds the upload limit. Record a shorter turn.",
            );
            return;
          }
          this.chunks.push(event.data);
        }
      };
      recorder.onerror = () => {
        this.cancel();
        onError("Audio recording failed. Check the microphone and retry.");
      };
      recorder.start(1000);
      this.started = performance.now();
      onMeter(false);
      try {
        const context = new AudioContext();
        this.context = context;
        void context.resume().catch(() => {});
        if (generation !== this.generation) return;
        const source = context.createMediaStreamSource(stream),
          analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        let last = 0;
        onMeter(context.state === "running");
        context.onstatechange = () => onMeter(context.state === "running");
        const tick = (time: number) => {
          if (generation !== this.generation) return;
          if (time - last > 45) {
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(
              samples.reduce((sum, x) => sum + x * x, 0) / samples.length,
            );
            onLevel(Math.min(1, rms * 5));
            last = time;
          }
          this.frame = requestAnimationFrame(tick);
        };
        this.frame = requestAnimationFrame(tick);
      } catch {
        onMeter(
          false,
        ); /* Recording remains usable without amplitude analysis. */
      }
    } catch (error) {
      this.cancel();
      throw error;
    }
  }
  private release() {
    if (typeof cancelAnimationFrame !== "undefined")
      cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
  stop(): Promise<Recording> {
    if (this.stopPromise) return this.stopPromise;
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive")
      return Promise.reject(new Error("No active recording."));
    const durationSeconds = (performance.now() - this.started) / 1000;
    this.stopPromise = new Promise((resolve, reject) => {
      this.rejectStop = reject;
      recorder.onstop = () => {
        this.rejectStop = null;
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        this.chunks = [];
        this.recorder = null;
        this.generation++;
        this.release();
        if (!blob.size)
          reject(
            new Error(
              "The recording is empty. Check your microphone and try again.",
            ),
          );
        else if (durationSeconds < 0.4)
          reject(
            new Error(
              "Recording is too short. Speak for at least half a second.",
            ),
          );
        else resolve({ blob, durationSeconds });
      };
      recorder.onerror = () => {
        this.cancel();
        reject(new Error("Recording could not finish. Try again."));
      };
      recorder.stop();
      this.release();
    });
    return this.stopPromise;
  }
  cancel() {
    const reject = this.rejectStop;
    this.rejectStop = null;
    this.generation++;
    if (this.recorder) {
      this.recorder.onstop = null;
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
      this.recorder = null;
    }
    this.chunks = [];
    this.release();
    reject?.(new DOMException("Recording cancelled", "AbortError"));
  }
}
