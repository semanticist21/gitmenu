import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** The theme's own token names (src/index.css), so tailwind-merge sorts them into the same
 * groups as the values they stand for: `text-ui` is a font size, `h-row` a height,
 * `shadow-key` a shadow. src/theme/metrics.test.ts checks this list against index.css. */
export const themeTokens = {
  theme: {
    text: ["caption", "small", "ui", "large", "label-description", "code"],
    leading: ["ui", "row", "pane-header", "tab", "tab-compact", "part-title", "breadcrumbs", "status-bar", "scm-input"],
    spacing: ["row", "pane-header", "tab", "tab-compact", "part-title", "breadcrumbs", "status-bar", "control", "control-sm", "action", "action-sm", "icon", "indent", "code-line", "notification-margin", "tab-min"],
    container: ["welcome-button"],
    radius: ["inset", "control", "hover", "action", "menu", "label", "badge", "dialog"],
    shadow: ["widget", "quick-pick", "dialog", "key", "scroll-top", "scroll-left", "diff-original", "diff-modified", "unchanged-region"],
    ease: ["pane", "sash", "columns"],
    animate: ["menu-in", "hover-in", "progress"],
  },
  duration: ["pane", "sash", "columns", "fade"],
  delay: ["sash"],
};

const twMerge = extendTailwindMerge({
  extend: {
    theme: themeTokens.theme,
    classGroups: {
      duration: [{ duration: themeTokens.duration }],
      delay: [{ delay: themeTokens.delay }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
