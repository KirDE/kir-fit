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
});
