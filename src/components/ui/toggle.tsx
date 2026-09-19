"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

// Two VS Code toggles. `default`: a toolbar action that stays pressed (22px, 6px radius,
// toolbar.activeBackground when on). `outline`: an option toggle like Match Case (3px radius,
// inputOption.active* colors when on), which also fits a short text label.
export const toggleVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap border border-transparent text-inherit outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--vsc-focusBorder) disabled:cursor-default disabled:text-(--vsc-disabledForeground) [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-[22px] min-w-[22px] text-[12px]",
        lg: "h-[22px] min-w-[22px] text-[12px]",
        sm: "h-[22px] min-w-[22px] text-[12px]",
      },
      variant: {
        default:
          "rounded-[6px] px-[3px] not-disabled:hover:bg-(--vsc-toolbar-hoverBackground) data-pressed:bg-(--vsc-toolbar-activeBackground)",
        outline:
          "rounded-[3px] px-1.5 not-disabled:hover:bg-(--vsc-inputOption-hoverBackground) focus-visible:outline-dashed data-pressed:border-(--vsc-inputOption-activeBorder) data-pressed:bg-(--vsc-inputOption-activeBackground) data-pressed:text-(--vsc-inputOption-activeForeground)",
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
