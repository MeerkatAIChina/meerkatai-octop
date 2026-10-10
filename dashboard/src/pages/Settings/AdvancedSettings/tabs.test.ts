import { describe, expect, it, vi } from "vitest";

// The page module pulls react-pdf in transitively, and pdfjs needs DOMMatrix,
// which jsdom does not provide (the same gap that fails
// DocumentPreviewCore.docxSanitize.test.ts). This test only reads a tab
// catalogue, so stub the heavy module out rather than polyfill a global in
// the shared setup.
vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));

import { HIDDEN_TAB_KEYS } from "../../../config/hiddenFeatures";
import { TABS } from "./index";

describe("AdvancedSettings tab list", () => {
  it("drops the hidden updates tab", () => {
    const keys = TABS.map((tab) => tab.key);
    // Literal name pins the intent: un-hiding it must fail this test.
    expect(keys).not.toContain("updates");
    // Guards the wiring between the switch and this page.
    for (const hidden of HIDDEN_TAB_KEYS) {
      expect(keys).not.toContain(hidden);
    }
  });

  it("keeps the remaining tabs in order", () => {
    expect(TABS.map((tab) => tab.key)).toEqual([
      "env-vars",
      "observability",
      "backup",
      "https",
      "captcha",
    ]);
  });
});
