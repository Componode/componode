import { useEffect } from "react";

/**
 * Global `Ctrl+B` / `Cmd+B` shortcut (consistent with the `Ctrl+K` palette
 * convention — window-level, not suppressed inside inputs): at `>=md` it
 * toggles the desktop sidebar via the `componode:toggle-sidebar` event the
 * Sidebar listens for; below `md` it toggles the NavDrawer via callback.
 */
export function useSidebarShortcut({
  onToggleDrawer,
}: {
  onToggleDrawer: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "b") return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 768px)").matches) {
        window.dispatchEvent(new Event("componode:toggle-sidebar"));
      } else {
        onToggleDrawer();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggleDrawer]);
}
