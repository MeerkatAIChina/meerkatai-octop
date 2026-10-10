import { describe, expect, it } from "vitest";
import type { OctopUser } from "../api/modules/auth";
import { HIDDEN_NAV_KEYS } from "../config/hiddenFeatures";
import { buildNavSections } from "./sidebarNav";
import {
  createGroup,
  deleteGroup,
  editorFromCatalog,
  layoutFromEditor,
  placeItem,
  preservedPlacements,
  sectionsFromLayout,
  visibleEditorGroups,
} from "./sidebarNavLayout";

const adminUser = {
  id: 1,
  username: "admin",
  role: "admin",
  permissions: ["*"],
} as OctopUser;

const limitedUser = {
  id: 2,
  username: "ada",
  role: "user",
  permissions: [],
} as OctopUser;

function catalog() {
  return buildNavSections(adminUser, { mobileEnabled: true });
}

describe("sidebarNavLayout", () => {
  it("keeps the default catalog when no layout is saved", () => {
    const sections = catalog();
    expect(sectionsFromLayout(sections, null)).toBe(sections);
    const editor = editorFromCatalog(sections, null);
    expect(editor.ungrouped).toEqual([
      "chat",
      "experts",
      "tasks",
      "token-usage",
    ]);
    // "control" is gone: every item it held is hidden (see hiddenFeatures.ts).
    expect(editor.groups.map((group) => group.id)).toEqual([
      "settings",
      "admin",
    ]);
    expect(editor.hidden).toEqual([]);
  });

  it("omits empty groups and hidden items from the sidebar", () => {
    const sections = catalog();
    const applied = sectionsFromLayout(sections, {
      groups: [
        { id: "settings", name: "配置" },
        { id: "control" },
        { id: "c_emptygrp1", name: "空组" },
      ],
      items: [
        { key: "chat" },
        { key: "personalization", group: "settings" },
        { key: "token-usage", hidden: true },
        // Stands in for "any item a user parked in a built-in group" — the
        // keys that used to live here are hidden now.
        { key: "connectors", group: "control" },
      ],
    });
    expect(applied.map((section) => section.id ?? "front")).toEqual([
      "front",
      "settings",
      "control",
    ]);
    expect(applied[0]?.items.map((item) => item.key)).toEqual(["chat"]);
    expect(applied[1]?.title).toBe("配置");
    expect(applied[1]?.items.map((item) => item.key)).toEqual([
      "personalization",
    ]);
    expect(applied[2]?.groupKey).toBe("nav.control");
  });

  it("sends keys missing from a saved layout to hidden", () => {
    const editor = editorFromCatalog(catalog(), {
      groups: [{ id: "settings" }],
      items: [{ key: "chat" }],
    });
    expect(editor.ungrouped).toEqual(["chat"]);
    expect(editor.hidden).toContain("experts");
    expect(editor.hidden).toContain("personalization");
    expect(
      sectionsFromLayout(catalog(), {
        groups: [{ id: "settings" }],
        items: [{ key: "chat" }],
      })
        .flatMap((section) => section.items.map((item) => item.key))
        .includes("experts"),
    ).toBe(false);
  });

  it("keeps hidden nav items out of the editor and the sidebar", () => {
    const sections = catalog();
    const saved = {
      groups: [{ id: "settings" }, { id: "control" }],
      items: [
        { key: "chat" },
        { key: "bridge" },
        { key: "workbench", group: "control" },
        { key: "connectors", group: "control" },
      ],
    };

    // Covers all three customizer zones: ungrouped, per-group, and the
    // "hidden items" list.
    const editor = editorFromCatalog(sections, saved);
    const shown = [
      ...editor.ungrouped,
      ...Object.values(editor.itemsByGroup).flat(),
      ...editor.hidden,
    ];
    for (const key of HIDDEN_NAV_KEYS) {
      expect(shown).not.toContain(key);
    }
    expect(shown).toContain("connectors");

    const rendered = sectionsFromLayout(sections, saved).flatMap((section) =>
      section.items.map((item) => item.key),
    );
    for (const key of HIDDEN_NAV_KEYS) {
      expect(rendered).not.toContain(key);
    }

    // A hidden key already sitting in the stored layout survives a save
    // round-trip, so un-hiding restores the user's placement instead of
    // silently dropping it.
    const preserved = preservedPlacements(saved, sections);
    expect(preserved.map((item) => item.key)).toEqual(["bridge", "workbench"]);
    const roundTripped = layoutFromEditor(editor, preserved).items.map(
      (item) => item.key,
    );
    expect(roundTripped).toContain("bridge");
    expect(roundTripped).toContain("workbench");
  });

  it("moves a deleted group's items to the front of the ungrouped list", () => {
    const editor = editorFromCatalog(catalog(), null);
    const next = deleteGroup(editor, "settings");
    expect(next.groups.map((group) => group.id)).toEqual(["admin"]);
    expect(next.ungrouped.slice(0, 2)).toEqual(["personalization", "channels"]);
    expect(next.ungrouped).toContain("chat");
  });

  it("places an item before another and can hide it", () => {
    const editor = editorFromCatalog(catalog(), null);
    const moved = placeItem(editor, "tasks", { kind: "ungrouped" }, "chat");
    expect(moved.ungrouped.slice(0, 2)).toEqual(["tasks", "chat"]);
    const hidden = placeItem(moved, "tasks", { kind: "hidden" }, null);
    expect(hidden.ungrouped).not.toContain("tasks");
    expect(hidden.hidden).toContain("tasks");
    const layout = layoutFromEditor(hidden);
    expect(layout.items.find((item) => item.key === "tasks")?.hidden).toBe(
      true,
    );
  });

  it("omits nav items and built-in groups the user cannot access", () => {
    const sections = buildNavSections(limitedUser, { mobileEnabled: false });
    const editor = editorFromCatalog(sections, {
      groups: [
        { id: "settings" },
        { id: "admin" },
        { id: "c_aabbccdd", name: "常用" },
      ],
      items: [
        { key: "chat" },
        { key: "admin-users", group: "admin" },
        { key: "channels", group: "settings" },
        { key: "personalization", group: "settings" },
      ],
    });
    const shown = [
      ...editor.ungrouped,
      ...Object.values(editor.itemsByGroup).flat(),
      ...editor.hidden,
    ];
    expect(shown).not.toContain("admin-users");
    expect(shown).not.toContain("channels");
    expect(shown).toContain("chat");
    expect(shown).toContain("personalization");
    expect(
      visibleEditorGroups(editor, sections).map((group) => group.id),
    ).toEqual(["settings", "c_aabbccdd"]);
  });

  it("keeps a new empty group only in the editor", () => {
    const editor = createGroup(
      editorFromCatalog(catalog(), null),
      "c_aabbccdd",
      "常用",
    );
    expect(editor.groups.at(-1)?.name).toBe("常用");
    const applied = sectionsFromLayout(catalog(), layoutFromEditor(editor));
    expect(applied.some((section) => section.id === "c_aabbccdd")).toBe(false);
  });
});
