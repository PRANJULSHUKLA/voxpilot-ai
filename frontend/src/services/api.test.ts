import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";
afterEach(() => vi.unstubAllGlobals());
it("aborts the underlying fetch and describes server-side cancellation limits", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  const controller = new AbortController();
  const pending = api("/chat", { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toThrow(
    "The server may still finish and save the result.",
  );
});
it("preserves the correlation ID without exposing raw server errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: { message: "Gemini unavailable", trace_id: "trace-123" },
      }),
    }),
  );
  await expect(api("/chat")).rejects.toMatchObject({
    message: "Gemini unavailable",
    traceId: "trace-123",
  });
});
