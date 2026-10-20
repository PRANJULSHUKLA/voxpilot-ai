// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Composer } from "./Composer";
afterEach(cleanup);
const props = {
  text: "",
  setText: vi.fn(),
  listening: false,
  interim: "",
  supported: true,
  busy: false,
  disabled: false,
  onListen: vi.fn(),
  onStop: vi.fn(),
  onSubmit: vi.fn(),
  maxLength: 12000,
};
describe("reviewed transcript composer", () => {
  it("does not submit interim recognition text", () => {
    const submit = vi.fn();
    render(<Composer {...props} interim="interim words" onSubmit={submit} />);
    expect(screen.getByText("Hearing: interim words")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Send message",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
  it("stops listening and submits finalized edited text only on action", () => {
    const submit = vi.fn(),
      stop = vi.fn();
    render(
      <Composer
        {...props}
        text="reviewed words"
        onSubmit={submit}
        onStop={stop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(stop).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });
  it("disables duplicate submissions during a request", () => {
    const submit = vi.fn();
    render(<Composer {...props} text="hello" busy={true} onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(submit).not.toHaveBeenCalled();
  });
  it("provides fallback and a discard action", () => {
    const change = vi.fn();
    render(
      <Composer
        {...props}
        supported={false}
        text="discard me"
        setText={change}
      />,
    );
    expect(screen.getByText(/Audio recording is unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(change).toHaveBeenCalledWith("");
  });
});
it("retains oversized speech for editing while preventing submission", () => {
  const submit = vi.fn();
  render(
    <Composer
      {...props}
      text="too many words"
      maxLength={5}
      onSubmit={submit}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain(
    "no speech has been discarded",
  );
  expect(
    (screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});
