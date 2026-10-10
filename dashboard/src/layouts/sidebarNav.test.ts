import { describe, expect, it } from "vitest";
import {
  SIDEBAR_GROUPED_NAV_KEYS,
  SIDEBAR_NAV_KEYS,
  buildNavSections,
  isGroupedNavKey,
} from "./sidebarNav";
import { HIDDEN_NAV_KEYS } from "../config/hiddenFeatures";
import type { OctopUser } from "../api/modules/auth";

const adminUser = {
  id: 1,
  username: "admin",
  role: "admin",
  permissions: ["*"],
} as OctopUser;

describe("sidebarNav", () => {
  it("marks catalog keys as grouped", () => {
    for (const key of SIDEBAR_GROUPED_NAV_KEYS) {
      expect(isGroupedNavKey(key)).toBe(true);
    }
    expect(isGroupedNavKey("chat")).toBe(false);
    expect(isGroupedNavKey("experts")).toBe(false);
  });

  it("places grouped keys only under sections with groupKey", () => {
    const sections = buildNavSections(adminUser, { mobileEnabled: true });
    const flatKeys = new Set(
      sections
        .filter((s) => !s.groupKey)
        .flatMap((s) => s.items.map((i) => i.key)),
    );
    const groupedKeys = new Set(
      sections
        .filter((s) => s.groupKey)
        .flatMap((s) => s.items.map((i) => i.key)),
    );
    for (const key of groupedKeys) {
      expect(isGroupedNavKey(key)).toBe(true);
      expect(flatKeys.has(key)).toBe(false);
    }
    for (const key of flatKeys) {
      expect(isGroupedNavKey(key)).toBe(false);
    }
  });

  it("covers every catalog key from the admin nav except the hidden ones", () => {
    const keys = buildNavSections(adminUser, { mobileEnabled: true }).flatMap(
      (section) => section.items.map((item) => item.key),
    );
    const expected = SIDEBAR_NAV_KEYS.filter(
      (key) => !HIDDEN_NAV_KEYS.has(key),
    );
    expect(new Set(keys)).toEqual(new Set(expected));
  });

  // Both halves are deliberate: the literals pin the intended behaviour (so
  // un-hiding a feature fails loudly instead of silently drifting), while the
  // loop guards the wiring between the switch and buildNavSections.
  it("omits the hidden nav items", () => {
    const keys = buildNavSections(adminUser, { mobileEnabled: true }).flatMap(
      (section) => section.items.map((item) => item.key),
    );
    expect(keys).not.toContain("bridge");
    expect(keys).not.toContain("workbench");
    expect(keys).not.toContain("remote-desktop");
    expect(keys).not.toContain("acp");
    for (const key of HIDDEN_NAV_KEYS) {
      expect(keys).not.toContain(key);
    }
  });

  it("drops a group whose items are all hidden", () => {
    const sections = buildNavSections(adminUser, { mobileEnabled: true });
    const groupIds = sections.flatMap((section) =>
      section.id ? [section.id] : [],
    );
    // "control" holds exactly workbench / remote-desktop / acp.
    expect(groupIds).toEqual(["settings", "admin"]);
    expect(sections.some((s) => s.groupKey === "nav.control")).toBe(false);
  });
});
