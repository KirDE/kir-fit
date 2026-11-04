// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { Progress } from "./main";
vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), api: vi.fn() }));
vi.mock("recharts", () => {
  const Box = ({ children }: any) => <div>{children}</div>;
  return { LineChart: Box, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, ResponsiveContainer: Box };
});
describe("personal progress UI", () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem("kirfit_language", "en"); vi.mocked(api).mockReset(); });
  afterEach(cleanup);
  it("keeps body weight first and handles a user with no completed machine history", async () => {
    vi.mocked(api).mockResolvedValue([]);
    const { container } = render(<Progress />);
    await screen.findByText("Log a set in a completed workout to see machine progress here.");
    expect(screen.queryByRole("combobox")).toBeNull();
    const body = container.querySelector(".weight-in-progress")!;
    const machines = container.querySelector(".machine-progress")!;
    expect(body.compareDocumentPosition(machines) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(vi.mocked(api).mock.calls.some(([path]) => path === "/exercises")).toBe(false);
  });
  it("cannot display an old exercise response after selecting a new machine", async () => {
    let resolveOld!: (value: any) => void;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    vi.mocked(api).mockImplementation((path: string) => {
      if (path === "/body-weight") return Promise.resolve([]);
      if (path === "/exercises/history") return Promise.resolve([{ id: "a", nameEn: "A" }, { id: "b", nameEn: "B" }]);
      if (path === "/exercises/a/progress") return old as any;
      if (path === "/exercises/b/progress") return Promise.resolve({ history: [{ date: "2026-11-04", weight: 40, volume: 400 }] });
      throw new Error(path);
    });
    const { container } = render(<Progress />);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "b" } });
    await waitFor(() => expect(container.querySelector(".machine-progress .grid strong")?.textContent).toContain("40"));
    await act(async () => resolveOld({ history: [{ date: "2026-11-03", weight: 10, volume: 100 }] }));
    expect(container.querySelector(".machine-progress .grid strong")?.textContent).toContain("40");
  });
});
