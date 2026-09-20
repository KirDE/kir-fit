// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workout } from "./main";
import { guestApi } from "./guest";

describe("active workout menu", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("kirfit_guest", "1");
    localStorage.setItem("kirfit_language", "en");
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("allows an incomplete workout to be finished from the overflow menu", async () => {
    const done = vi.fn();
    render(<Workout done={done} />);

    await screen.findByText(/0 \/ \d+ completed/);
    const finishButtons = screen.getAllByRole("button", {
      name: "Finish workout",
    });
    expect(finishButtons).toHaveLength(1);
    expect(finishButtons[0].closest("details.workout-menu")).not.toBeNull();

    fireEvent.click(screen.getByLabelText("Workout menu"));
    fireEvent.click(finishButtons[0]);

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Finish this workout? You can resume it from today's history.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Finish workout" }));

    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(await guestApi("/workouts/active")).toBeNull();
    const history: any[] = await guestApi("/history");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      status: "completed",
      summary: { setCount: 0 },
    });
  });
  it("persists machine notes when settings are reopened and in the next workout", async () => {
    render(<Workout done={vi.fn()} />);

    await screen.findByText(/0 \/ \d+ completed/);
    fireEvent.click(screen.getByRole("button", { name: "Exercise settings" }));
    const notes = screen.getByLabelText("Machine notes");
    fireEvent.change(notes, { target: { value: "Seat 4, neutral grip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Machine notes")).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Exercise settings" }));
    expect(
      (screen.getByLabelText("Machine notes") as HTMLTextAreaElement).value,
    ).toBe("Seat 4, neutral grip");

    const active: any = await guestApi("/workouts/active");
    await guestApi(`/workouts/${active.id}/finish`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const next: any = await guestApi("/workouts/start", {
      method: "POST",
      body: JSON.stringify({ clientMutationId: crypto.randomUUID() }),
    });
    expect(next.exercises[0].notes).toBe("Seat 4, neutral grip");
  });

});
