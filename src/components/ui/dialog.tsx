"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type React from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// VS Code's modal dialog (base/browser/ui/dialog/dialog.css): a 50% black backdrop without
// blur, a 12px-radius box at least 480px wide (clamped to the window), a toolbar row with the
// close action, the message row, then right-aligned 26px buttons. Nothing animates.

export const DialogCreateHandle: typeof DialogPrimitive.createHandle =
  DialogPrimitive.createHandle;

export const Dialog: typeof DialogPrimitive.Root = DialogPrimitive.Root;

export const DialogPortal: typeof DialogPrimitive.Portal =
  DialogPrimitive.Portal;

export function DialogTrigger(
  props: DialogPrimitive.Trigger.Props,
): React.ReactElement {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

export function DialogClose(
  props: DialogPrimitive.Close.Props,
): React.ReactElement {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export function DialogBackdrop({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props): React.ReactElement {
  return (
    <DialogPrimitive.Backdrop
      className={cn("fixed inset-0 z-50 bg-black/50", className)}
      data-slot="dialog-backdrop"
      {...props}
    />
  );
}

export function DialogViewport({
  className,
  ...props
}: DialogPrimitive.Viewport.Props): React.ReactElement {
  return (
    <DialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center",
        className,
      )}
      data-slot="dialog-viewport"
      {...props}
    />
  );
}

/** The dialog box; `className` is merged onto the box. */
export const dialogBoxClassName =
  "relative flex max-h-[90vh] min-h-[75px] w-min min-w-[min(480px,calc(100vw-16px))] max-w-[90vw] flex-col rounded-dialog border border-widget-border bg-editor-widget p-2 text-editor-widget-foreground outline-none shadow-dialog";

export function DialogPopup({
  className,
  children,
  showCloseButton = true,
  closeLabel = "Close Dialog",
  closeProps,
  portalProps,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
  closeLabel?: string;
  closeProps?: DialogPrimitive.Close.Props;
  portalProps?: DialogPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <DialogPortal {...portalProps}>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPrimitive.Popup
          className={cn(dialogBoxClassName, className)}
          data-slot="dialog-popup"
          {...props}
        >
          <div
            className="flex h-6 shrink-0 items-start justify-end pb-1"
            data-slot="dialog-toolbar"
          >
            {showCloseButton && (
              <DialogPrimitive.Close
                aria-label={closeLabel}
                render={<Button size="icon" variant="action" />}
                {...closeProps}
              >
                <Icon name="close" />
              </DialogPrimitive.Close>
            )}
          </div>
          {children}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  );
}

/** The message row: title and detail, indented to where VS Code's text starts. */
export function DialogHeader({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex min-h-0 shrink flex-col overflow-y-auto overflow-x-hidden pr-2 pl-6 select-text [overflow-wrap:break-word]",
      className,
    ),
    "data-slot": "dialog-header",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

/** The buttons row: right-aligned, wrapping instead of clipping in a narrow window. */
export function DialogFooter({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "flex shrink-0 flex-wrap items-center justify-end pt-5 min-[496px]:ml-[67px] [&>*:focus-visible]:outline-offset-1 [&>*]:m-1 [&>*]:w-fit [&>*]:min-w-0 [&>*]:max-w-[calc(100%-8px)]",
      className,
    ),
    "data-slot": "dialog-footer",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export function DialogTitle({
  className,
  ...props
}: DialogPrimitive.Title.Props): React.ReactElement {
  return (
    <DialogPrimitive.Title
      className={cn(
        "mb-1 flex min-h-[22px] items-center font-semibold text-large leading-[18.2px]",
        className,
      )}
      data-slot="dialog-title"
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props): React.ReactElement {
  return (
    <DialogPrimitive.Description
      className={cn("whitespace-pre-wrap text-ui leading-5", className)}
      data-slot="dialog-description"
      {...props}
    />
  );
}

/** Rows under the message (inputs, checkbox), 15px apart as in VS Code. */
export function DialogPanel({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn("flex min-h-0 flex-col pt-[15px] pr-2 pl-6", className),
    "data-slot": "dialog-panel",
  };

  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(defaultProps, props),
    render,
  });
}

export {
  DialogPrimitive,
  DialogBackdrop as DialogOverlay,
  DialogPopup as DialogContent,
};
