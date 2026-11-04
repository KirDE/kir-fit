// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workout } from "./main";
import { guestApi } from "./guest";
import { queue } from "./offline";

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
  it("opens the selected machine, keeps carousel navigation and returns to the grid", async () => {
    render(<Workout done={vi.fn()} />);
    const grid = await screen.findByLabelText("Exercises");
    const tiles = within(grid).getAllByRole("button");
    const names = tiles.map((tile) => tile.getAttribute("aria-label")!);
    expect(tiles.length).toBeGreaterThan(2);
    expect(screen.queryByRole("button", { name: "Exercise settings" })).toBeNull();
    fireEvent.click(tiles[1]);
    expect(screen.getByRole("heading", { name: names[1], level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next exercise" }));
    expect(screen.getByRole("heading", { name: names[2], level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole("heading", { name: names[1], level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exercises" }));
    expect(within(screen.getByLabelText("Exercises")).getAllByRole("button")).toHaveLength(tiles.length);
  });

  it("persists machine notes when settings are reopened and in the next workout", async () => {
    render(<Workout done={vi.fn()} />);

    await screen.findByText(/0 \/ \d+ completed/);
    const grid = screen.getByLabelText("Exercises");
    fireEvent.click(within(grid).getAllByRole("button")[0]);
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


describe("authenticated workout finish", () => {
  const session = {
    id: "current",
    startedAt: "2026-10-07T21:50:00.000Z",
    status: "active",
    exercises: [{ id: "exercise", plannedSets: 1, sets: [{ id: "set", weight: 20, reps: 10, setNumber: 1, rir: null }] }],
  };
  const stale = { id: "stale", path: "/workouts/old/sets", init: { method: "POST", body: "old payload" } };
  const current = { id: "current-set", path: "/workouts/current/sets", init: { method: "POST", body: "current payload" } };
  const unsyncedMessage = "Some sets in this workout could not be synced. Your sets are saved on this device. Try finishing again.";

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("kirfit_token", "test-token");
    localStorage.setItem("kirfit_language", "en");
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-07T22:10:00.000Z")); // 00:10 in Berlin
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function confirmFinish() {
    await screen.findByText("1 / 1 completed");
    const primary = screen.getAllByRole("button", { name: "Finish workout" }).find((button) => button.closest(".workout-complete"))!;
    fireEvent.click(primary);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Finish workout" }));
  }

  it.each([false, true])("finishes after midnight with stale other-session writes (current pending=%s)", async (pending) => {
    queue(stale);
    if (pending) queue(current);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/workouts/active") return Response.json(session);
      if (path === "/api/workouts/current/sets") return Response.json({});
      if (path === "/api/workouts/current/finish") {
        expect(JSON.parse(localStorage.getItem("kirfit_pending")!)).toEqual([stale]);
        return Response.json({ ...session, status: "completed" });
      }
      return Response.json({ error: "session is not active" }, { status: 404 });
    }));
    const done = vi.fn();
    render(<Workout done={done} />);
    await confirmFinish();

    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(calls).toEqual([
      "/api/workouts/active",
      ...(pending ? ["/api/workouts/current/sets"] : []),
      "/api/workouts/current/finish",
    ]);
    expect(JSON.parse(localStorage.getItem("kirfit_pending")!)).toEqual([stale]);
    expect(screen.queryByText(unsyncedMessage)).toBeNull();
  });

  it("blocks finish on current-session sync failure, preserves writes, and allows retry", async () => {
    queue(stale);
    queue(current);
    let failSync = true;
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path === "/api/workouts/active") return Response.json(session);
      if (path.endsWith("/sets") && failSync) return Response.json({ error: "invalid set" }, { status: 400 });
      return Response.json({});
    }));
    const done = vi.fn();
    render(<Workout done={done} />);
    await confirmFinish();

    await screen.findByText(unsyncedMessage);
    expect(calls).toEqual(["/api/workouts/active", "/api/workouts/current/sets"]);
    expect(done).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("kirfit_pending")!)).toEqual([stale, current]);
    expect(screen.queryByText(/Check the connection/)).toBeNull();

    failSync = false;
    await confirmFinish();
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(calls.slice(-2)).toEqual(["/api/workouts/current/sets", "/api/workouts/current/finish"]);
    expect(JSON.parse(localStorage.getItem("kirfit_pending")!)).toEqual([stale]);
  });
});
