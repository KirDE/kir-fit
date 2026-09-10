// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Nutrition, NutritionDashboardCard } from "./Nutrition";
import { localDate, moveLocalDate } from "./nutrition";

describe("nutrition mobile workflow", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

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

  it("recognizes a manually described meal and keeps the estimate editable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/nutrition/photos/analyze-text") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ description: "Chicken curry with rice" });
        return Response.json({ analysis: {
          summary: "Chicken curry with rice",
          foods: [{
            name: "Chicken curry and rice",
            portion: { estimatedGrams: 450 },
            calories: { estimate: 680 },
            proteinGrams: { estimate: 42 },
            fatGrams: { estimate: 24 },
            carbsGrams: { estimate: 72 },
            fiberGrams: { estimate: 6 },
          }],
          assumptions: [],
          clarificationQuestions: [],
        } });
      }
      if (url.endsWith("/api/nutrition/photos"))
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("{}", { status: 404 });
    }));

    render(<Nutrition />);
    await screen.findByText("No food recorded for this day.");
    fireEvent.click(screen.getByRole("button", { name: /add food/i }));
    fireEvent.click(screen.getByRole("button", { name: /enter manually/i }));
    const title = screen.getByLabelText("Meal name");
    expect((screen.getByRole("button", { name: /estimate from description/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(title, { target: { value: "Chicken curry with rice" } });
    fireEvent.click(screen.getByRole("button", { name: /estimate from description/i }));

    await waitFor(() => expect((screen.getByLabelText("Food") as HTMLInputElement).value).toBe("Chicken curry and rice"));
    const numeric = within(screen.getByLabelText("Food").closest("fieldset")!).getAllByRole("spinbutton");
    expect(numeric.map((input) => (input as HTMLInputElement).value)).toEqual([
      "450", "680", "42", "24", "72", "6",
    ]);
    fireEvent.change(numeric[0], { target: { value: "500" } });
    expect((numeric[0] as HTMLInputElement).value).toBe("500");
  });

  it("includes today's completed photo estimates on the home dashboard", async () => {
    localStorage.setItem(
      "kirfit_guest_nutrition_v1",
      JSON.stringify({
        profile: {
          heightCm: 180,
          goalWeightKg: null,
          proteinTargetMode: "manual",
          manualProteinTargetGrams: 100,
        },
        entries: [],
      }),
    );
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/nutrition/photos")) {
        return new Response(JSON.stringify([{
          analysisId: "analysis-dashboard-1",
          status: "completed",
          createdAt: new Date().toISOString(),
          result: {
            summary: "Protein meal",
            foods: [{
              name: "Chicken",
              portion: { estimatedGrams: 200 },
              calories: { estimate: 420 },
              proteinGrams: { estimate: 35 },
              fatGrams: { estimate: 14 },
              carbsGrams: { estimate: 30 },
              fiberGrams: { estimate: 4 },
            }],
            assumptions: [],
            clarificationQuestions: [],
          },
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    const { container } = render(<NutritionDashboardCard open={() => undefined} />);

    const dashboard = await within(container).findByRole("button", { name: /protein/i });
    expect(dashboard.textContent).toMatch(/35 \/ 100 g/);
    expect(dashboard.textContent).toMatch(/35% · 420 kcal/);
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

  it("treats a photo estimate as ready and lets only its weight be edited", async () => {
    let photoDeleted = false;
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
      clarificationQuestions: [],
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/nutrition/photos/analysis-async-1") && init?.method === "DELETE") {
        photoDeleted = true;
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/api/nutrition/photos")) {
        return new Response(JSON.stringify(photoDeleted ? [] : [{
          analysisId: "analysis-async-1",
          status: "manual_required",
          createdAt: new Date().toISOString(),
          result: analysis,
          failureCode: "malformed_response",
          message: "The updated estimate was incomplete",
          thumbnailUrl: null,
          metadata: { clarificationRound: 0 },
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    const { container } = render(<Nutrition />);
    const open = await screen.findByRole("button", {
      name: /breaded fish and vegetables.*ready/i,
    });
    expect(container.querySelector(".nutrition-protein")?.textContent).toMatch(/30 \/ — g/);
    expect(container.querySelector(".nutrition-macros")?.textContent).toMatch(/360kcal/);
    expect(open.textContent).toMatch(/360 kcal.*30 g protein/i);
    fireEvent.click(open);
    const details = await screen.findByRole("dialog");
    expect(within(details).getByRole("heading", { name: /meal details/i })).toBeTruthy();
    expect(within(details).getByText(/recognized from the photo/i)).toBeTruthy();
    expect(screen.queryByText(/photo analysis is unavailable/i)).toBeNull();
    expect(within(details).queryByText(/optional questions/i)).toBeNull();
    expect(within(details).queryByLabelText("Meal name")).toBeNull();
    expect(within(details).queryByLabelText("Food")).toBeNull();
    const weight = within(details).getByRole("spinbutton") as HTMLInputElement;
    expect(within(details).getAllByRole("spinbutton")).toHaveLength(1);
    fireEvent.focus(weight);
    fireEvent.change(weight, { target: { value: "" } });
    expect(weight.value).toBe("");
    fireEvent.change(weight, { target: { value: "360" } });
    expect(weight.value).toBe("360");
    expect(within(details).getByText("720")).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const saved = JSON.parse(localStorage.getItem("kirfit_guest_nutrition_v1") || "{}");
    expect(saved.entries[0]).toMatchObject({
      title: "Breaded fish and vegetables",
      calories: 720,
      proteinGrams: 60,
      items: [{ estimatedGrams: 360 }],
    });
  });

  it("closes the chooser immediately and shows an uploading photo card", async () => {
    let finishUpload!: (response: Response) => void;
    const uploadResponse = new Promise<Response>((resolve) => { finishUpload = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/nutrition/photos/analyze") && init?.method === "POST") {
        expect((init.body as FormData).get("occurredOn")).toBe(
          moveLocalDate(localDate(), -1),
        );
        return uploadResponse;
      }
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
    fireEvent.click(within(container).getByRole("button", { name: "Previous day" }));
    await within(container).findByText("No food recorded for this day.");
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

  it("keeps questions optional and marks them with a small card indicator", async () => {
    let clarificationQueued = false;
    let clarificationAnswers: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/clarify") && init?.method === "POST") {
        clarificationQueued = true;
        clarificationAnswers = JSON.parse(String(init.body)).answers;
        return new Response(JSON.stringify({
          analysisId: "analysis-final-review",
          status: "processing",
        }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/nutrition/photos")) {
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
          metadata: { clarificationRound: 0 },
          thumbnailUrl: null,
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    render(<Nutrition />);
    const open = await screen.findByRole("button", {
      name: /final fish estimate.*ready.*optional questions/i,
    });
    expect(within(open).getByLabelText("Optional questions")).toBeTruthy();
    expect(screen.getByText("30 / — g")).toBeTruthy();
    fireEvent.click(open);
    const details = await screen.findByRole("dialog");
    expect(within(details).getByRole("heading", { name: /meal details/i })).toBeTruthy();
    expect(within(details).getByText("Another detail?")).toBeTruthy();
    expect(screen.queryByText(/review estimate/i)).toBeNull();
    fireEvent.click(within(details).getByText("Optional questions"));
    fireEvent.change(within(details).getByLabelText("Comment"), {
      target: { value: "The sauce was served separately" },
    });
    fireEvent.click(within(details).getByRole("button", { name: /update estimate/i }));
    await waitFor(() => expect(clarificationQueued).toBe(true));
    expect(clarificationAnswers).toEqual({
      additional_context: "The sauce was served separately",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("labels the selected day and keeps meals separated while navigating", async () => {
    const today = localDate();
    const yesterday = moveLocalDate(today, -1);
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
            id: "today-meal",
            occurredAt: `${today}T12:00:00`,
            mealType: "lunch",
            title: "Today meal",
            consumedPercent: 100,
            calories: 300,
            proteinGrams: 30,
            fatGrams: 10,
            carbsGrams: 20,
            fiberGrams: 3,
            items: [],
          },
          {
            id: "yesterday-meal",
            occurredAt: `${yesterday}T12:00:00`,
            mealType: "lunch",
            title: "Yesterday meal",
            consumedPercent: 100,
            calories: 200,
            proteinGrams: 20,
            fatGrams: 8,
            carbsGrams: 15,
            fiberGrams: 2,
            items: [],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    ));

    const { container } = render(<Nutrition />);
    await within(container).findByText("Today meal");
    expect(within(container).getByText("Today")).toBeTruthy();

    fireEvent.click(within(container).getByRole("button", { name: "Previous day" }));
    await within(container).findByText("Yesterday meal");
    expect(within(container).queryByText("Today meal")).toBeNull();
    expect(within(container).getByText("Yesterday")).toBeTruthy();
    expect(within(container).getByText("20 / 100 g")).toBeTruthy();

    fireEvent.click(within(container).getByRole("button", { name: /yesterday.*back to today/i }));
    await within(container).findByText("Today meal");
    expect(within(container).queryByText("Yesterday meal")).toBeNull();
    expect(within(container).getByText("30 / 100 g")).toBeTruthy();
  });

  it("ignores a late response from a previously selected day", async () => {
    localStorage.removeItem("kirfit_guest");
    localStorage.setItem("kirfit_token", "test-token");
    const today = localDate();
    const yesterday = moveLocalDate(today, -1);
    let resolveToday!: (response: Response) => void;
    const delayedToday = new Promise<Response>((resolve) => { resolveToday = resolve; });
    const day = (date: string, title: string) => ({
      date,
      proteinTarget: 100,
      totals: { calories: 250, proteinGrams: 25, fatGrams: 8, carbsGrams: 20, fiberGrams: 2 },
      entries: [{
        id: `${date}-meal`,
        occurredAt: `${date}T12:00:00Z`,
        mealType: "lunch",
        title,
        consumedPercent: 100,
        calories: 250,
        proteinGrams: 25,
        fatGrams: 8,
        carbsGrams: 20,
        fiberGrams: 2,
        items: [],
      }],
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`/api/nutrition/days/${today}`)) return delayedToday;
      if (url.includes(`/api/nutrition/days/${yesterday}`)) {
        return new Response(JSON.stringify(day(yesterday, "Selected yesterday")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/nutrition/photos")) {
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    const { container } = render(<Nutrition />);
    fireEvent.click(within(container).getByRole("button", { name: "Previous day" }));
    await within(container).findByText("Selected yesterday");

    await act(async () => {
      resolveToday(new Response(JSON.stringify(day(today, "Late today")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
      await delayedToday;
    });
    expect(within(container).getByText("Selected yesterday")).toBeTruthy();
    expect(within(container).queryByText("Late today")).toBeNull();
    expect(within(container).getByText("Yesterday")).toBeTruthy();
  });

  it("rounds combined journal and photo nutrients for display", async () => {
    localStorage.setItem(
      "kirfit_guest_nutrition_v1",
      JSON.stringify({
        profile: {
          heightCm: 180,
          goalWeightKg: null,
          proteinTargetMode: "manual",
          manualProteinTargetGrams: 100,
        },
        entries: [{
          id: "decimal-meal",
          occurredAt: `${localDate()}T12:00:00`,
          mealType: "lunch",
          title: "Decimal meal",
          consumedPercent: 100,
          calories: 100,
          proteinGrams: 0.2,
          fatGrams: 0.2,
          carbsGrams: 0.2,
          fiberGrams: 0.2,
          items: [],
        }],
      }),
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
      analysisId: "decimal-analysis",
      status: "completed",
      occurredOn: localDate(),
      createdAt: new Date().toISOString(),
      result: {
        summary: "Decimal estimate",
        foods: [{
          name: "Small serving",
          portion: { estimatedGrams: 1 },
          calories: { estimate: 1 },
          proteinGrams: { estimate: 0.1 },
          fatGrams: { estimate: 0.1 },
          carbsGrams: { estimate: 0.1 },
          fiberGrams: { estimate: 0.1 },
        }],
        assumptions: [],
        clarificationQuestions: [],
      },
    }]), { status: 200, headers: { "Content-Type": "application/json" } })));

    render(<Nutrition />);
    await screen.findByText("Decimal estimate");
    for (const label of ["Fat, g", "Carbs, g", "Fiber, g"]) {
      expect(screen.getByText(label).closest("span")?.querySelector("b")?.textContent).toBe("0.3");
    }
    expect(screen.getByText("0.3 / 100 g")).toBeTruthy();
    expect(document.body.textContent).not.toContain("0.30000000000000004");
  });

  it("deletes a photo analysis only from details after confirmation", async () => {
    let deleted = false;
    const job = {
      analysisId: "analysis-safe-delete",
      status: "completed",
      occurredOn: localDate(),
      createdAt: new Date().toISOString(),
      result: {
        summary: "Meal to delete",
        foods: [{
          name: "Food",
          portion: { estimatedGrams: 100 },
          calories: { estimate: 200 },
          proteinGrams: { estimate: 20 },
          fatGrams: { estimate: 8 },
          carbsGrams: { estimate: 15 },
          fiberGrams: { estimate: 2 },
        }],
        assumptions: [],
        clarificationQuestions: [],
        sources: [{
          title: "Product source",
          url: "https://example.com/product",
        }],
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/nutrition/photos") && !init?.method) {
        return new Response(JSON.stringify(deleted ? [] : [job]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith(`/api/nutrition/photos/${job.analysisId}`) && init?.method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404 });
    }));

    render(<Nutrition />);
    const cardButton = await screen.findByRole("button", { name: /meal to delete.*ready/i });
    expect(screen.queryByLabelText("Delete pending photo")).toBeNull();
    expect(deleted).toBe(false);

    fireEvent.click(cardButton);
    const details = await screen.findByRole("dialog");
    expect(within(details).getByRole("link", { name: "Product source" }).getAttribute("href"))
      .toBe("https://example.com/product");
    const detailsPanel = details.firstElementChild!;
    expect(detailsPanel.lastElementChild?.classList.contains("nutrition-delete")).toBe(true);
    fireEvent.click(within(details).getByRole("button", { name: /^delete$/i }));
    const confirmation = await screen.findByRole("alertdialog");
    expect(within(confirmation).getByText("Delete this photo analysis?")).toBeTruthy();
    expect(deleted).toBe(false);

    fireEvent.click(within(confirmation).getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(deleted).toBe(true));
    await waitFor(() => expect(screen.queryByText("Meal to delete")).toBeNull());
  });
});
