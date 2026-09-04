// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Nutrition } from "./Nutrition";
import { localDate } from "./nutrition";

describe("nutrition mobile workflow", () => {
  afterEach(() => vi.unstubAllGlobals());

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("kirfit_guest", "1");
    localStorage.setItem("kirfit_language", "en");
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  it("keeps totals empty until manual review is explicitly saved", async () => {
    render(<Nutrition />);
    await screen.findByText("No food recorded for this day.");
    fireEvent.click(screen.getByRole("button", { name: /add food/i }));
    fireEvent.click(screen.getByRole("button", { name: /enter manually/i }));

    fireEvent.change(screen.getByLabelText("Meal name"), {
      target: { value: "Protein bowl" },
    });
    fireEvent.change(screen.getByLabelText("Food"), {
      target: { value: "Chicken and rice" },
    });
    const item = screen.getByLabelText("Food").closest("fieldset")!;
    const numeric = within(item).getAllByRole("spinbutton");
    fireEvent.change(numeric[0], { target: { value: "400" } });
    fireEvent.change(numeric[1], { target: { value: "600" } });
    fireEvent.change(numeric[2], { target: { value: "60" } });
    fireEvent.change(numeric[3], { target: { value: "15" } });
    fireEvent.change(numeric[4], { target: { value: "55" } });
    fireEvent.change(numeric[5], { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "50%" }));

    expect(localStorage.getItem("kirfit_guest_nutrition_v1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /save to journal/i }));
    await screen.findByText("Protein bowl");
    expect(screen.getByText("30 g")).toBeTruthy();
    expect(screen.getByText("300 kcal")).toBeTruthy();
  });

  it("shows uncapped protein percent and updates after deleting an entry", async () => {
    localStorage.setItem(
      "kirfit_guest_nutrition_v1",
      JSON.stringify({
        profile: {
          heightCm: 180,
          goalWeightKg: null,
          proteinTargetMode: "manual",
          manualProteinTargetGrams: 100,
        },
        entries: [
          {
            id: "meal-1",
            occurredAt: `${localDate()}T12:00:00`,
            mealType: "lunch",
            title: "Protein day",
            consumedPercent: 100,
            calories: 1000,
            proteinGrams: 125,
            fatGrams: 20,
            carbsGrams: 50,
            fiberGrams: 8,
            items: [
              {
                id: "food-1",
                name: "Protein foods",
                estimatedGrams: 700,
                calories: 1000,
                proteinGrams: 125,
                fatGrams: 20,
                carbsGrams: 50,
                fiberGrams: 8,
              },
            ],
          },
        ],
      }),
    );
    render(<Nutrition />);
    await screen.findByText("125%");
    expect(screen.getByText("Target exceeded")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /protein day/i }));
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await screen.findByRole("alertdialog");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(screen.queryByText("Protein day")).toBeNull());
    expect(screen.getByText("No food recorded for this day.")).toBeTruthy();
  });

  it("shows a saved estimate after provider failure and queues clarification without blocking", async () => {
    let clarificationQueued = false;
    const analysis = {
      summary: "Breaded fish and vegetables",
      foods: [{
        name: "Breaded fish",
        portion: { estimatedGrams: 180 },
        calories: { estimate: 360 },
        proteinGrams: { estimate: 30 },
        fatGrams: { estimate: 18 },
        carbsGrams: { estimate: 22 },
        fiberGrams: { estimate: 1 },
      }],
      assumptions: [],
      clarificationQuestions: [{
        id: "protein",
        question: "What is inside the breading?",
        options: ["White fish", "Chicken"],
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/clarify") && init?.method === "POST") {
        clarificationQueued = true;
        return new Response(JSON.stringify({
          analysisId: "analysis-async-1",
          status: "processing",
          result: analysis,
        }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/nutrition/photos")) {
        return new Response(JSON.stringify([{
          analysisId: "analysis-async-1",
          status: clarificationQueued ? "processing" : "manual_required",
          createdAt: new Date().toISOString(),
          result: analysis,
          failureCode: clarificationQueued ? undefined : "malformed_response",
          message: clarificationQueued ? undefined : "The updated estimate was incomplete",
          thumbnailUrl: null,
          metadata: { clarificationRound: 0 },
        }]), { status: clarificationQueued ? 202 : 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    const { container } = render(<Nutrition />);
    const open = await screen.findByRole("button", {
      name: /breaded fish and vegetables.*answer questions/i,
    });
    expect(container.querySelector(".nutrition-protein")?.textContent).toMatch(/30 \/ — g/);
    expect(container.querySelector(".nutrition-macros")?.textContent).toMatch(/360kcal/);
    expect(open.textContent).toMatch(/360 kcal.*30 g protein/i);
    fireEvent.click(open);
    await screen.findByText(/estimated from a photo/i);
    expect(screen.queryByText(/photo analysis is unavailable/i)).toBeNull();
    expect(screen.getByRole("button", { name: /review estimate/i })).toBeTruthy();
    await screen.findByText("What is inside the breading?");
    fireEvent.click(screen.getByLabelText("White fish"));
    fireEvent.click(screen.getByRole("button", { name: /update estimate/i }));
    await waitFor(() => expect(clarificationQueued).toBe(true));
    await screen.findByText("Analysis in progress");
    expect(screen.queryByText("What is inside the breading?")).toBeNull();
  });

  it("closes the chooser immediately and shows an uploading photo card", async () => {
    let finishUpload!: (response: Response) => void;
    const uploadResponse = new Promise<Response>((resolve) => { finishUpload = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/nutrition/photos/analyze") && init?.method === "POST")
        return uploadResponse;
      if (url.endsWith("/api/nutrition/photos"))
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 404 });
    }));
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:meal-preview"),
      revokeObjectURL: vi.fn(),
    });

    const { container } = render(<Nutrition />);
    await screen.findByText("No food recorded for this day.");
    fireEvent.click(within(container).getByRole("button", { name: /add food/i }));
    const input = container.querySelector('input[type="file"][capture="environment"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["photo"], "meal.jpg", { type: "image/jpeg" })] },
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const pending = await screen.findByText("Estimating food and portions…");
    expect(pending.closest(".nutrition-analysis-card")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector('img[src="blob:meal-preview"]')).toBeTruthy();

    finishUpload(new Response(JSON.stringify({
      analysisId: "analysis-upload-1",
      status: "processing",
      createdAt: new Date().toISOString(),
    }), { status: 202, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:meal-preview"));
  });

  it("offers review instead of more questions after the clarification limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/nutrition/photos")) {
        return new Response(JSON.stringify([{
          analysisId: "analysis-final-review",
          status: "completed",
          createdAt: new Date().toISOString(),
          result: {
            summary: "Final fish estimate",
            foods: [{
              name: "Fish",
              portion: { estimatedGrams: 180 },
              calories: { estimate: 360 },
              proteinGrams: { estimate: 30 },
              fatGrams: { estimate: 18 },
              carbsGrams: { estimate: 22 },
              fiberGrams: { estimate: 1 },
            }],
            assumptions: [],
            clarificationQuestions: [{
              id: "extra",
              question: "Another detail?",
              options: ["Yes", "No"],
            }],
          },
          metadata: { clarificationRound: 1 },
          thumbnailUrl: null,
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    render(<Nutrition />);
    const open = await screen.findByRole("button", {
      name: /final fish estimate.*review estimate/i,
    });
    fireEvent.click(open);
    await screen.findByRole("heading", { name: /review meal/i });
    expect(screen.queryByText("Another detail?")).toBeNull();
  });
});
