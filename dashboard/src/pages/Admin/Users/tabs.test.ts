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

describe("Admin/Users tab list", () => {
  it("drops the hidden SSO tabs", () => {
    const keys = TABS.map((tab) => tab.key);
    // Literal names pin the intent: un-hiding one must fail this test.
    expect(keys).not.toContain("oidc");
    expect(keys).not.toContain("ldap");
    // Guards the wiring between the switch and this page.
    for (const hidden of HIDDEN_TAB_KEYS) {
      expect(keys).not.toContain(hidden);
    }
  });

  it("keeps the remaining tabs in order", () => {
    expect(TABS.map((tab) => tab.key)).toEqual([
      "local",
      "roles",
      "feishu",
      "wecom",
      "dingtalk",
    ]);
  });
});
