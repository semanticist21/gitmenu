"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { Dialog as CommandDialogPrimitive } from "@base-ui/react/dialog";
import * as React from "react";
import { Keybinding } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

// VS Code's quick input (platform/quickinput/browser): a 12px-radius widget 6px below the top
// edge, full width minus 8px margins in a narrow window, no backdrop. Header with a 26px filter
// input, 22px rows (44px with a detail line) with a 3px radius, bold match highlights, key caps
// on the right. Opens and closes without animation; Escape or a click outside cancels.

export const quickInputWidgetClassName =
  "fixed top-1.5 left-1/2 z-50 flex max-h-[calc(100vh-12px)] w-[calc(100vw-16px)] -translate-x-1/2 flex-col rounded-dialog border border-widget-border bg-quick-input text-quick-input-foreground text-ui leading-[normal] outline-none shadow-quick-pick min-[600px]:w-[min(62vw,600px)]";

/** The filter/input box: 26px, 6px radius, input colors, focusBorder outline. */
export const quickInputBoxClassName =
  "h-control w-full min-w-0 rounded-action border border-input-border bg-input-background px-1.5 py-1 text-input-foreground text-ui text-ellipsis leading-4 outline-none focus:outline-solid focus:outline-1 focus:-outline-offset-1 focus:outline-focus data-[severity=error]:border-validation-error-border data-[severity=error]:outline-validation-error-border data-[severity=info]:border-validation-info-border data-[severity=info]:outline-validation-info-border data-[severity=warning]:border-validation-warning-border data-[severity=warning]:outline-validation-warning-border";

/** A list row: 22px (or two 22px lines), 3px radius, focus and hover colors. */
export const quickInputRowClassName =
  "group/quick-row flex min-h-row cursor-default select-none items-center rounded-inset px-1.5 leading-row outline-none hover:bg-list-hover data-disabled:text-disabled data-highlighted:bg-quick-input-focus data-highlighted:text-quick-input-focus-foreground";

export function CommandDialog({
  modal = false,
  ...props
}: CommandDialogPrimitive.Root.Props): React.ReactElement {
  return <CommandDialogPrimitive.Root modal={modal} {...props} />;
}

export const CommandDialogPortal: typeof CommandDialogPrimitive.Portal =
  CommandDialogPrimitive.Portal;

export const CommandCreateHandle: typeof CommandDialogPrimitive.createHandle =
  CommandDialogPrimitive.createHandle;

export function CommandDialogTrigger(
  props: CommandDialogPrimitive.Trigger.Props,
): React.ReactElement {
  return (
    <CommandDialogPrimitive.Trigger
      data-slot="command-dialog-trigger"
      {...props}
    />
  );
}

/** The quick input widget. */
export function CommandDialogPopup({
  className,
  children,
  portalProps,
  ...props
}: CommandDialogPrimitive.Popup.Props & {
  portalProps?: CommandDialogPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <CommandDialogPortal {...portalProps}>
      <CommandDialogPrimitive.Popup
        className={cn(quickInputWidgetClassName, className)}
        data-slot="command-dialog-popup"
        {...props}
      >
        {children}
      </CommandDialogPrimitive.Popup>
    </CommandDialogPortal>
  );
}

/** Title bar, shown only when the input has a title. */
export function QuickInputTitle({
  className,
  children,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center rounded-t-[calc(var(--radius-dialog)-1px)] bg-quick-input-title",
        className,
      )}
      data-slot="quick-input-title"
      {...props}
    >
      <div className="min-w-0 flex-1 truncate py-[3px] text-center">
        {children}
      </div>
    </div>
  );
}

export function QuickInputHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex flex-col px-1.5 pt-1.5 pb-1", className)}
      data-slot="quick-input-header"
      {...props}
    />
  );
}

/**
 * The line under an input box: the prompt, or a validation message boxed in the
 * inputValidation colors.
 */
export function QuickInputMessage({
  severity,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  severity?: "error" | "warning" | "info";
}): React.ReactElement {
  return (
    <div
      className={cn(
        "-mt-px select-text p-[5px] leading-ui [overflow-wrap:break-word]",
        severity === "error" &&
          "-mb-0.5 border border-validation-error-border bg-validation-error",
        severity === "warning" &&
          "-mb-0.5 border border-validation-warning-border bg-validation-warning",
        severity === "info" &&
          "-mb-0.5 border border-validation-info-border bg-validation-info",
        className,
      )}
      data-slot="quick-input-message"
      role={severity ? "alert" : undefined}
      {...props}
    />
  );
}

const matcher = new Intl.Collator(undefined, {
  ignorePunctuation: true,
  sensitivity: "base",
  usage: "search",
});

/** Bolds the part of `text` that matched the filter query (same matching as the filter). */
export function QuickInputHighlight({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.ReactElement {
  const q = query.trim();
  if (q) {
    for (let i = 0; i <= text.length - q.length; i += 1) {
      if (matcher.compare(text.slice(i, i + q.length), q) === 0) {
        return (
          <>
            {text.slice(0, i)}
            <span className="font-bold text-list-highlight group-data-highlighted/quick-row:text-quick-input-focus-highlight">
              {text.slice(i, i + q.length)}
            </span>
            {text.slice(i + q.length)}
          </>
        );
      }
    }
  }
  return <>{text}</>;
}

/** A row's label with its description on one line, cut by one trailing ellipsis. */
export function QuickInputLabel({
  label,
  description,
  query = "",
  className,
}: {
  label: string;
  description?: string;
  query?: string;
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cn("min-w-0 flex-1 truncate", className)}
      data-slot="quick-input-label"
    >
      <span className="whitespace-pre">
        <QuickInputHighlight query={query} text={label} />
      </span>
      {description && (
        <span className="ms-[.5em] whitespace-pre text-label-description opacity-95 group-data-highlighted/quick-row:opacity-100 dark:opacity-70">
          <QuickInputHighlight query={query} text={description} />
        </span>
      )}
    </span>
  );
}

export function Command({
  autoHighlight = "always",
  keepHighlight = true,
  // Hovering shows list.hoverBackground; only the keyboard moves the focused row
  highlightItemOnHover = false,
  ...props
}: React.ComponentProps<typeof AutocompletePrimitive.Root>): React.ReactElement {
  return (
    <AutocompletePrimitive.Root
      autoHighlight={autoHighlight}
      highlightItemOnHover={highlightItemOnHover}
      inline
      keepHighlight={keepHighlight}
      open
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: AutocompletePrimitive.Input.Props): React.ReactElement {
  return (
    <QuickInputHeader>
      <AutocompletePrimitive.Input
        autoFocus
        className={cn(quickInputBoxClassName, className)}
        data-slot="command-input"
        {...props}
      />
    </QuickInputHeader>
  );
}

export function CommandList({
  className,
  ...props
}: AutocompletePrimitive.List.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.List
      className={cn(
        "max-h-[min(440px,40vh)] overflow-y-auto px-1.5 pb-[7px] empty:pb-0",
        className,
      )}
      data-slot="command-list"
      {...props}
    />
  );
}

/** The "No matching …" row. */
export function CommandEmpty({
  className,
  ...props
}: AutocompletePrimitive.Empty.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Empty
      className={cn("px-3 pb-[7px] leading-row empty:hidden", className)}
      data-slot="command-empty"
      {...props}
    />
  );
}

/** Kept for the coss API: the list sits directly in the widget. */
export function CommandPanel({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex min-h-0 flex-col", className)}
      data-slot="command-panel"
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: AutocompletePrimitive.Group.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Group
      className={className}
      data-slot="command-group"
      {...props}
    />
  );
}

/** A group's label, right-aligned on its first row in pickerGroup.foreground. */
export function CommandGroupLabel({
  className,
  ...props
}: AutocompletePrimitive.GroupLabel.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.GroupLabel
      className={cn(
        "border-picker-group-border border-t px-1.5 text-right text-picker-group-foreground text-caption leading-row [[data-slot=command-group]:first-child_&]:border-t-0",
        className,
      )}
      data-slot="command-group-label"
      {...props}
    />
  );
}

export const CommandCollection: typeof AutocompletePrimitive.Collection =
  AutocompletePrimitive.Collection;

export function CommandItem({
  className,
  ...props
}: AutocompletePrimitive.Item.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Item
      className={cn(quickInputRowClassName, className)}
      data-slot="command-item"
      {...props}
    />
  );
}

export function CommandSeparator({
  className,
  ...props
}: AutocompletePrimitive.Separator.Props): React.ReactElement {
  return (
    <AutocompletePrimitive.Separator
      className={cn("my-0 h-0 border-picker-group-border border-t", className)}
      data-slot="command-separator"
      {...props}
    />
  );
}

/** Key caps at the right of a row; on the focused or hovered row they lose their fill. */
export function CommandShortcut({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  children: string;
}): React.ReactElement {
  return (
    <Keybinding
      className={cn(
        "ms-2 me-2 shrink-0 [[data-highlighted]_&_[data-slot=kbd]]:border-[color-mix(in_srgb,currentColor_30%,transparent)] [[data-highlighted]_&_[data-slot=kbd]]:bg-transparent [[data-slot=command-item]:hover_&_[data-slot=kbd]]:border-[color-mix(in_srgb,currentColor_30%,transparent)] [[data-slot=command-item]:hover_&_[data-slot=kbd]]:bg-transparent [[data-highlighted]_&]:text-inherit",
        className,
      )}
      data-slot="command-shortcut"
      value={children}
      {...props}
    />
  );
}

export function CommandFooter({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("px-1.5 pb-1.5 text-small", className)}
      data-slot="command-footer"
      {...props}
    />
  );
}

export { CommandDialogPrimitive };
