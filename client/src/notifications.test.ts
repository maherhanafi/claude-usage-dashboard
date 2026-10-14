import { describe, expect, it } from "vitest";
import { toNotificationText } from "./notifications";

describe("toNotificationText", () => {
  it("joins warnings into a single human-readable message", () => {
    expect(toNotificationText(["A warning", "Another warning"])).toBe("A warning • Another warning");
  });

  it("returns null for empty or missing warnings", () => {
    expect(toNotificationText([])).toBeNull();
    expect(toNotificationText(undefined)).toBeNull();
  });
});
