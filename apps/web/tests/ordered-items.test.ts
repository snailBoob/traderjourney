import { describe, expect, it } from "vitest";
import { orderedItems } from "../src/lib/ordered-items";

describe("saved folder order", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "new" }];
  it("restores saved order, omits deleted folders and appends new folders", () => {
    expect(orderedItems(items, ["deleted", "b", "a"])).toEqual([items[1], items[0], items[2]]);
  });
  it("keeps creation order before an order is saved", () => {
    expect(orderedItems(items, undefined)).toEqual(items);
  });
  it("does not duplicate folders when saved IDs repeat", () => {
    expect(orderedItems(items, ["b", "b", null])).toEqual([items[1], items[0], items[2]]);
  });
});
