// Firefox rejects permission names it does not implement. This rewrites a built copy.
// src/manifest.json and the Chrome output stay on the Chrome manifest.

export const FIREFOX_GECKO_ID = "qz-browser-agent@heleifz.github.io";
export const FIREFOX_MIN_VERSION = "139.0";
export const FIREFOX_DROPPED_PERMISSIONS = Object.freeze([
  "debugger",
  "desktopCapture",
  "offscreen",
  "sidePanel",
]);

const droppedPermissions = new Set(FIREFOX_DROPPED_PERMISSIONS);

/** Return a Manifest V3 document Firefox can load as a temporary add-on. */
export function firefoxManifest(manifest) {
  if (!manifest || manifest.manifest_version !== 3) {
    throw new Error("Firefox manifest requires Manifest V3");
  }
  const worker = manifest.background?.service_worker;
  if (!worker || manifest.background.type !== "module") {
    throw new Error("Firefox background expects the module service worker entry");
  }
  const panel = manifest.side_panel?.default_path;
  if (!panel) throw new Error("Firefox sidebar requires side_panel.default_path");

  const next = structuredClone(manifest);
  delete next.key;
  delete next.side_panel;
  if (Array.isArray(next.permissions)) {
    next.permissions = next.permissions.filter(permission => !droppedPermissions.has(permission));
  }
  if (Array.isArray(next.optional_permissions)) {
    next.optional_permissions = next.optional_permissions.filter(permission => !droppedPermissions.has(permission));
    if (!next.optional_permissions.length) delete next.optional_permissions;
  }
  // Firefox starts background.scripts and does not run background.service_worker.
  // Keeping both matches the cross-browser manifest shape; Chrome is a separate output.
  next.background = {
    scripts: [worker],
    service_worker: worker,
    type: "module",
  };
  const sidebarAction = {
    default_panel: panel,
    open_at_install: false,
  };
  const sidebarTitle = next.action?.default_title || next.name;
  const sidebarIcon = next.action?.default_icon || next.icons;
  if (sidebarTitle) sidebarAction.default_title = sidebarTitle;
  if (sidebarIcon) sidebarAction.default_icon = sidebarIcon;
  next.sidebar_action = sidebarAction;
  next.browser_specific_settings = {
    gecko: {
      id: FIREFOX_GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
    },
  };
  return next;
}
