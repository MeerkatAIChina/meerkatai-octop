import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE,
  LEGACY_PALETTE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  VALID_PALETTES,
} from "./themePalettes";

const INDEX_HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");

// Extracted so the tests can `eval` it in jsdom. eval is intentional here: the
// subject under test *is* an inline script that only exists inside index.html,
// so there is nothing to import. It is this repo's own source, read from disk
// at test time — not external or user-supplied input.
function bootThemeScript(): string {
  const match = INDEX_HTML.match(
    /<script id="octop-boot-theme">([\s\S]*?)<\/script>/,
  );
  if (!match) {
    throw new Error("octop-boot-theme script missing from index.html");
  }
  return match[1];
}

function stubMatchMedia(systemDark: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("prefers-color-scheme: dark") ? systemDark : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

describe("index.html boot theme", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
    stubMatchMedia(true);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(THEME_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
  });

  it("styles the splash from data-theme, not OS color scheme", () => {
    expect(INDEX_HTML).toContain('html[data-theme="dark"] #octop-boot');
    expect(INDEX_HTML).not.toMatch(
      /@media \(prefers-color-scheme: dark\)[\s\S]*#octop-boot/,
    );
  });

  it("uses the white vertical mark in dark mode", () => {
    expect(INDEX_HTML).toContain('src="/logo_vertical_white.svg"');
    expect(INDEX_HTML).toContain(
      'html[data-theme="dark"] .octop-boot-logo--dark',
    );
  });

  it("keeps a stored light preference over OS dark", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light", palette: "rose" }),
    );
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("honors a stored dark preference", () => {
    stubMatchMedia(false);
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "dark", palette: "rose" }),
    );
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows the OS when preference is system or missing", () => {
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    document.documentElement.removeAttribute("data-theme");
    stubMatchMedia(false);
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("migrates a legacy plain theme string", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    eval(bootThemeScript());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("index.html boot palette", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PALETTE_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-palette");
    stubMatchMedia(false);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(LEGACY_PALETTE_STORAGE_KEY);
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-palette");
  });

  function bootPalette(): string | null {
    eval(bootThemeScript());
    return document.documentElement.getAttribute("data-palette");
  }

  // The boot script carries its own copy of the palette list and of
  // DEFAULT_PALETTE, because it runs before any bundle is parsed. The next two
  // tests fail loudly if that copy drifts from themePalettes.ts — which is the
  // only failure mode that would silently flash the wrong brand colour.
  it("defaults to DEFAULT_PALETTE when nothing is stored", () => {
    expect(bootPalette()).toBe(DEFAULT_PALETTE);
  });

  it("accepts every curated palette defined in themePalettes", () => {
    for (const palette of VALID_PALETTES) {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ preference: "light", palette }),
      );
      expect(bootPalette()).toBe(palette);
    }
  });

  it("honors the derived custom palette", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "dark", palette: "custom" }),
    );
    expect(bootPalette()).toBe("custom");
  });

  it("falls back to the default for an unknown palette", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light", palette: "chartreuse" }),
    );
    expect(bootPalette()).toBe(DEFAULT_PALETTE);
  });

  it("falls back to the default when the stored JSON has no palette", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light" }),
    );
    expect(bootPalette()).toBe(DEFAULT_PALETTE);
  });

  it("migrates the legacy palette-only key", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    localStorage.setItem(LEGACY_PALETTE_STORAGE_KEY, "teal");
    expect(bootPalette()).toBe("teal");
  });

  it("prefers the JSON palette over the legacy key", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ preference: "light", palette: "amber" }),
    );
    localStorage.setItem(LEGACY_PALETTE_STORAGE_KEY, "teal");
    expect(bootPalette()).toBe("amber");
  });

  it("ignores an invalid legacy palette value", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    localStorage.setItem(LEGACY_PALETTE_STORAGE_KEY, "not-a-palette");
    expect(bootPalette()).toBe(DEFAULT_PALETTE);
  });
});
