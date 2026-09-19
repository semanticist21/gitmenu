"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type React from "react";
import { cn } from "@/lib/utils";

// VS Code's compact hover (base/browser/ui/hover/hoverWidget.css): 12px text, 2px 8px
// padding, 5px radius, editorHoverWidget colors, no arrow. Shows after 1.5s (instantly
// within 200ms of the previous one hiding), fades in over 100ms, hides at once.

export const TooltipCreateHandle: typeof TooltipPrimitive.createHandle =
  TooltipPrimitive.createHandle;

export function TooltipProvider({
  delay = 1500,
  closeDelay = 0,
  timeout = 200,
  ...props
}: TooltipPrimitive.Provider.Props): React.ReactElement {
  return (
    <TooltipPrimitive.Provider
      closeDelay={closeDelay}
      delay={delay}
      timeout={timeout}
      {...props}
    />
  );
}

export const Tooltip: typeof TooltipPrimitive.Root = TooltipPrimitive.Root;

export function TooltipTrigger({
  delay = 1500,
  closeDelay = 0,
  ...props
}: TooltipPrimitive.Trigger.Props): React.ReactElement {
  return (
    <TooltipPrimitive.Trigger
      closeDelay={closeDelay}
      data-slot="tooltip-trigger"
      delay={delay}
      {...props}
    />
  );
}

export function TooltipPopup({
  className,
  align = "center",
  sideOffset = 2,
  side = "top",
  anchor,
  children,
  portalProps,
  ...props
}: TooltipPrimitive.Popup.Props & {
  align?: TooltipPrimitive.Positioner.Props["align"];
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: TooltipPrimitive.Positioner.Props["sideOffset"];
  anchor?: TooltipPrimitive.Positioner.Props["anchor"];
  portalProps?: TooltipPrimitive.Portal.Props;
}): React.ReactElement {
  return (
    <TooltipPrimitive.Portal {...portalProps}>
      <TooltipPrimitive.Positioner
        align={align}
        anchor={anchor}
        className="z-50"
        collisionPadding={2}
        data-slot="tooltip-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "max-h-[50vh] max-w-[min(700px,calc(100vw-4px))] animate-[fadein_100ms_linear] select-text overflow-hidden rounded-[5px] border border-(--vsc-editorHoverWidget-border) bg-(--vsc-editorHoverWidget-background) px-2 py-0.5 text-(--vsc-editorHoverWidget-foreground) text-[12px] leading-[19px] [overflow-wrap:break-word] [box-shadow:var(--vsc-shadow-lg)] data-instant:animate-none [&_code]:rounded-[3px] [&_code]:bg-(--vsc-textCodeBlock-background) [&_code]:px-[.4em]",
            className,
          )}
          data-slot="tooltip-popup"
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { TooltipPrimitive, TooltipPopup as TooltipContent };
