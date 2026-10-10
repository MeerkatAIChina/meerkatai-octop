import { describe, expect, it } from "vitest";
import {
  ADVANCED_TAB_PERMISSIONS,
  canAccessPath,
  NAV_PERMISSIONS,
  pathPermissionKeys,
  PERM,
  routeNeedsPermission,
} from "../utils/permissions";
import { HIDDEN_NAV_KEYS } from "../config/hiddenFeatures";
import { isWorkbenchPath, resolveSelectedKey, routeConfigs } from "./index";

describe("pathPermissionKeys", () => {
  it("matches workbench and legacy aliases", () => {
    expect(isWorkbenchPath("/workbench")).toBe(true);
    expect(pathPermissionKeys("/workbench")).toEqual([...PERM.workbench]);
    expect(pathPermissionKeys("/workbench/terminal")).toEqual([
      ...PERM.terminal,
    ]);
    expect(pathPermissionKeys("/workbench/browser")).toEqual([...PERM.browser]);
    expect(pathPermissionKeys("/terminal")).toEqual([...PERM.terminal]);
    expect(pathPermissionKeys("/remote-browser")).toEqual([...PERM.browser]);
  });

  it("matches remote desktop hub tabs and acp", () => {
    expect(pathPermissionKeys("/remote-desktop")).toEqual([
      "desktop",
      "mobile",
    ]);
    expect(pathPermissionKeys("/remote-desktop/desktop")).toEqual([
      ...PERM.desktop,
    ]);
    expect(pathPermissionKeys("/remote-desktop/phone")).toEqual([
      ...PERM.mobile,
    ]);
    expect(pathPermissionKeys("/remote-phone")).toEqual([...PERM.mobile]);
    expect(pathPermissionKeys("/acp")).toBe("admin");
  });

  it("keeps sso on users page, not advanced", () => {
    expect(pathPermissionKeys("/admin/users")).toEqual([...PERM.usersPage]);
    expect(pathPermissionKeys("/admin/advanced")).toEqual([
      ...PERM.advancedPage,
    ]);
    expect([...PERM.advancedPage]).not.toContain("sso");
    expect(NAV_PERMISSIONS["admin-users"]).toEqual(PERM.usersPage);
    expect(NAV_PERMISSIONS["admin-advanced"]).toEqual(PERM.advancedPage);
    expect(ADVANCED_TAB_PERMISSIONS.captcha).toBe("captcha");
    expect("bridge" in ADVANCED_TAB_PERMISSIONS).toBe(false);
    expect(pathPermissionKeys("/bridge")).toBeNull();
    expect([...PERM.advancedPage]).toContain("captcha");
  });

  it("keeps voice and search on models page, not advanced", () => {
    expect(pathPermissionKeys("/admin/models")).toEqual([...PERM.modelsPage]);
    expect(pathPermissionKeys("/admin/voice")).toEqual([...PERM.modelsPage]);
    expect([...PERM.modelsPage]).toContain("voice");
    expect([...PERM.modelsPage]).toContain("search");
    expect([...PERM.advancedPage]).not.toContain("voice");
    expect([...PERM.advancedPage]).not.toContain("search");
    expect(NAV_PERMISSIONS.models).toEqual(PERM.modelsPage);
  });

  it("does not gate common pages", () => {
    expect(pathPermissionKeys("/chat")).toBeNull();
    expect(pathPermissionKeys("/experts")).toBeNull();
    expect(pathPermissionKeys("/tasks")).toBeNull();
    expect(pathPermissionKeys("/token-usage")).toBeNull();
    expect(pathPermissionKeys("/personalization/skills")).toBeNull();
    expect(pathPermissionKeys("/bridge")).toBeNull();
  });

  it("gates settings modules", () => {
    expect(pathPermissionKeys("/connectors")).toEqual([...PERM.connectors]);
    expect(pathPermissionKeys("/skill-packages")).toEqual([
      ...PERM.skillPackages,
    ]);
    expect(pathPermissionKeys("/personalization/channels")).toEqual([
      ...PERM.channels,
    ]);
    expect(pathPermissionKeys("/knowledge-bases")).toEqual([
      ...PERM.knowledgeBasesPage,
    ]);
    expect([...PERM.advancedPage]).not.toContain("knowledge_settings");
  });

  // The remote-desktop / acp paths that used to be the fixtures here are
  // hidden now, so canAccessPath short-circuits them before permissions are
  // consulted. These use visible paths with the same shapes: a single-key
  // gate, a two-key any-of gate, and the admin sentinel.
  it("canAccessPath respects holder permissions", () => {
    const user = { role: "user", permissions: ["connectors"] };
    expect(canAccessPath(user, "/connectors")).toBe(true);
    expect(canAccessPath(user, "/knowledge-bases")).toBe(false);
    expect(canAccessPath(user, "/admin/users")).toBe(false);
    expect(
      canAccessPath({ role: "admin", permissions: [] }, "/admin/advanced"),
    ).toBe(true);
    expect(
      canAccessPath(
        { role: "user", permissions: ["knowledge_bases"] },
        "/knowledge-bases",
      ),
    ).toBe(true);
    expect(
      canAccessPath(
        { role: "user", permissions: ["knowledge_settings"] },
        "/knowledge-bases",
      ),
    ).toBe(true);
    expect(
      canAccessPath(
        { role: "user", permissions: ["knowledge_bases"] },
        "/admin/advanced",
      ),
    ).toBe(false);
  });
});

describe("unknown dashboard paths", () => {
  it("do not highlight a sidebar item", () => {
    expect(resolveSelectedKey("/does-not-exist")).toBe("");
  });

  it("are caught by the not-found route", () => {
    expect(routeConfigs.some((rc) => rc.path === "*")).toBe(true);
  });
});

describe("hidden features", () => {
  const admin = { role: "admin", permissions: [] };
  // Enough module keys to clear every gate the hidden trees carry, so a
  // failure here can only come from the hidden-feature check.
  const privileged = {
    role: "user",
    permissions: ["desktop", "mobile", "browser", "terminal"],
  };

  it("keeps hidden route trees unreachable for everyone", () => {
    const paths = [
      "/bridge",
      "/bridge/anything",
      "/workbench",
      "/workbench/terminal",
      "/workbench/browser",
      "/remote-desktop",
      "/remote-desktop/desktop",
      "/remote-desktop/phone",
      "/remote-desktop/phone/shell",
      "/acp",
    ];
    for (const path of paths) {
      expect(canAccessPath(admin, path)).toBe(false);
      expect(canAccessPath(privileged, path)).toBe(false);
    }
    for (const key of HIDDEN_NAV_KEYS) {
      expect(canAccessPath(admin, `/${key}`)).toBe(false);
    }
  });

  // /bridge carries no permission gate of its own (pathPermissionKeys returns
  // null for it), so MainLayout never wraps it in RequirePermission. Without
  // this the guard above would never run and the page would stay reachable.
  it("wraps every hidden route so the check actually runs", () => {
    for (const key of HIDDEN_NAV_KEYS) {
      expect(routeNeedsPermission(`/${key}`)).toBe(true);
    }
    expect(routeNeedsPermission("/bridge")).toBe(true);
    expect(routeNeedsPermission("/remote-desktop/phone")).toBe(true);
  });

  // Legacy paths that used to redirect into a hidden page now fall through to
  // the "*" route. Re-adding one without un-hiding its target would strand
  // users on a Forbidden page.
  it("no longer routes the hidden aliases", () => {
    const paths = routeConfigs.map((rc) => rc.path);
    for (const path of [
      "/personalization/acp",
      "/terminal",
      "/remote-browser",
      "/remote-phone",
      "/remote-android",
      "/admin/sso",
      "/admin/updates",
      "/updates",
    ]) {
      expect(paths).not.toContain(path);
    }
  });

  it("leaves visible paths reachable", () => {
    expect(canAccessPath(admin, "/chat")).toBe(true);
    expect(canAccessPath(admin, "/experts")).toBe(true);
    expect(canAccessPath(admin, "/knowledge-bases")).toBe(true);
    expect(canAccessPath(admin, "/admin/users")).toBe(true);
  });
});
