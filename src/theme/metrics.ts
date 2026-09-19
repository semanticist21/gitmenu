// Layout numbers that TypeScript needs (virtualizer row sizes, pane layout, canvas text
// measurement). src/index.css owns every value; each constant names its token, and
// metrics.test.ts fails when a constant and its token disagree.

/** `--spacing-row`: list, tree and table rows */
export const ROW_HEIGHT = 22
/** `--spacing-pane-header`: view pane headers */
export const PANE_HEADER_HEIGHT = 22
/** `--spacing-indent`: tree indent per level (`workbench.tree.indent`) */
export const INDENT = 8
/** `--spacing-icon`: codicon and avatar slots */
export const ICON_SIZE = 16
/** `--spacing-code-line`: diff and file editor lines */
export const CODE_LINE_HEIGHT = 18
/** `--text-code`: diff and file editor font size */
export const CODE_FONT_SIZE = 12
/** `--font-editor` */
export const CODE_FONT_FAMILY = 'Menlo, Monaco, "Courier New", monospace'
/** `--leading-scm-input`: one line of the commit message box */
export const SCM_INPUT_LINE_HEIGHT = 20
/** `--spacing-notification-margin`: toasts' distance from the window's right and bottom edges */
export const NOTIFICATION_MARGIN = 3

/** Each constant's owning token in src/index.css (read by metrics.test.ts). */
export const TOKENS = {
  ROW_HEIGHT: '--spacing-row',
  PANE_HEADER_HEIGHT: '--spacing-pane-header',
  INDENT: '--spacing-indent',
  ICON_SIZE: '--spacing-icon',
  CODE_LINE_HEIGHT: '--spacing-code-line',
  CODE_FONT_SIZE: '--text-code',
  CODE_FONT_FAMILY: '--font-editor',
  SCM_INPUT_LINE_HEIGHT: '--leading-scm-input',
  NOTIFICATION_MARGIN: '--spacing-notification-margin',
} as const
