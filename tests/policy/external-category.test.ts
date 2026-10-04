import { describe, expect, it } from "vitest";
import { resolveExternalCategory } from "../../lib/domain/categories.ts";
import { ProposeExternalPurchaseInput } from "../../lib/domain/external.ts";

describe("resolveExternalCategory", () => {
  it.each([
    ["Organic Whole Milk, 1 gallon", "grocery"],
    ["Free-range eggs (dozen)", "grocery"],
    ["Roma Tomatoes 2 lb", "grocery"],
    ["Dyson Pure Cool Tower Fan", "home_appliance"],
    ["Ceramic Space Heater 1500W", "home_appliance"],
    ["Food Processor 8-cup", "home_appliance"],
    ["DeWalt 20V Cordless Drill", "diy_tools"],
    ["Titanium Drill Bit Set", "diy_tools"],
    ["Wood Screws #8 x 2in (500 pack)", "diy_supplies"],
    ["Interior Paint, Eggshell, 1 gal", "diy_supplies"],
    ["Apple AirPods Pro", "general"],
    ["Leather notebook", "general"],
    ["Fancy desk lamp", "general"],
  ])("infers %s → %s", (name, expected) => {
    expect(resolveExternalCategory(name)).toBe(expected);
  });

  it("never falls back to software", () => {
    expect(resolveExternalCategory("Pro subscription")).toBe("general");
  });

  it("honors an agent-supplied category", () => {
    expect(resolveExternalCategory("Leather notebook", "diy_supplies")).toBe("diy_supplies");
    expect(resolveExternalCategory("Organic Whole Milk", "restaurant_food")).toBe("restaurant_food");
  });

  it("does not let an agent relabel a blocked category", () => {
    expect(resolveExternalCategory("$100 Amazon Gift Card", "general")).toBe("gift_card");
    expect(resolveExternalCategory("0.01 Bitcoin", "grocery")).toBe("crypto");
  });
});

describe("ProposeExternalPurchaseInput.category", () => {
  const base = { url: "https://shop.example.com/item", item_name: "Milk", claimed_price_cents: 499 };

  it("is optional and validated against known categories", () => {
    expect(ProposeExternalPurchaseInput.safeParse(base).success).toBe(true);
    expect(ProposeExternalPurchaseInput.safeParse({ ...base, category: "grocery" }).success).toBe(true);
    expect(ProposeExternalPurchaseInput.safeParse({ ...base, category: "weapons" }).success).toBe(false);
  });
});
