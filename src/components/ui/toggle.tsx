"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

// Two VS Code toggles. `default`: a toolbar action that stays pressed (22px, 6px radius,
// toolbar.activeBackground when on). `outline`: an option toggle like Match Case (3px radius,
// inputOption.active* colors when on), which also fits a short text label.
export const toggleVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap border border-transparent text-inherit outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus disabled:cursor-default disabled:text-disabled [&_svg:not([class*='size-'])]:size-icon [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-action min-w-action text-small",
        lg: "h-action min-w-action text-small",
        sm: "h-action min-w-action text-small",
      },
      variant: {
        default:
          "rounded-action px-[3px] not-disabled:hover:bg-toolbar-hover data-pressed:bg-toolbar-active",
        outline:
          "rounded-inset px-1.5 not-disabled:hover:bg-input-option-hover focus-visible:outline-dashed data-pressed:border-input-option-active-border data-pressed:bg-input-option-active data-pressed:text-input-option-active-foreground",
      },
    },
  },
);

export function Toggle({
  className,
  variant,
  size,
  ...props
}: TogglePrimitive.Props &
  VariantProps<typeof toggleVariants>): React.ReactElement {
  return (
    <TogglePrimitive
      className={cn(toggleVariants({ className, size, variant }))}
      data-slot="toggle"
      {...props}
    />
  );
}

export { TogglePrimitive };
