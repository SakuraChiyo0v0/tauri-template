import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutRecorderDialog } from "./shortcut-recorder-dialog";

afterEach(cleanup);

describe("ShortcutRecorderDialog", () => {
  it("records the latest key combination and confirms it", async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(async () => true);

    render(
      <ShortcutRecorderDialog
        open
        currentAccelerator="Ctrl+Shift+M"
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    const recorder = screen.getByRole("button", { name: "录制快捷键" });
    await waitFor(() => expect(recorder).toHaveFocus());

    fireEvent.keyDown(recorder, { key: "Y", code: "KeyY", ctrlKey: true, shiftKey: true });
    expect(screen.getByTestId("shortcut-preview")).toHaveTextContent("Ctrl+Shift+Y");

    fireEvent.keyDown(recorder, { key: "K", code: "KeyK", ctrlKey: true, altKey: true });
    expect(screen.getByTestId("shortcut-preview")).toHaveTextContent("Ctrl+Alt+K");

    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith("Ctrl+Alt+K"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("rejects unmodified keys and allows escape to cancel", async () => {
    const onOpenChange = vi.fn();

    render(
      <ShortcutRecorderDialog
        open
        currentAccelerator={null}
        onOpenChange={onOpenChange}
        onConfirm={vi.fn(async () => true)}
      />,
    );

    const recorder = screen.getByRole("button", { name: "录制快捷键" });
    fireEvent.keyDown(recorder, { key: "Y", code: "KeyY" });

    expect(screen.getByText("快捷键需要包含 Ctrl、Alt、Shift 或 Win 中的至少一个修饰键。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();

    fireEvent.keyDown(recorder, { key: "Escape", code: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
