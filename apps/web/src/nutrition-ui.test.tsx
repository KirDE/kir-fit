// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Nutrition } from "./Nutrition";
import { localDate } from "./nutrition";

describe("nutrition mobile workflow", () => {
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
});
