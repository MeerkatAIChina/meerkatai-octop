/**
 * Features hidden from every user, admins included.
 *
 * This gates visibility *on top of* the permission layer: `utils/permissions.ts`
 * lets admins through unconditionally, so "hidden from everyone" cannot be
 * expressed there.
 *
 * To bring a feature back: remove its key from the set below, then un-comment
 * the matching redirects in `routes/index.tsx` (each is annotated).
 */

/**
 * Nav item keys hidden from the sidebar and from the nav customizer.
 * Each key doubles as a route prefix (`bridge` -> `/bridge`), so the whole
 * route tree becomes unreachable too.
 */
export const HIDDEN_NAV_KEYS: ReadonlySet<string> = new Set([
  "bridge",
  "workbench",
  "remote-desktop",
  "acp",
]);

/**
 * Tab keys hidden from every tab bar. Keys are globally unique across pages,
 * so one set covers both the users page (`oidc` / `ldap`) and the advanced
 * settings page (`updates`).
 */
export const HIDDEN_TAB_KEYS: ReadonlySet<string> = new Set([
  "oidc",
  "ldap",
  "updates",
]);

/** Account menu entries hidden from the sidebar footer dropdown. */
export const HIDDEN_ACCOUNT_MENU: ReadonlySet<string> = new Set([
  "helpFeedback",
  "projectUrl",
  "checkUpdates",
]);

/** True when `pathname` falls inside a hidden nav item's route tree. */
export function isHiddenRoute(pathname: string): boolean {
  for (const key of HIDDEN_NAV_KEYS) {
    if (pathname === `/${key}` || pathname.startsWith(`/${key}/`)) return true;
  }
  return false;
}
