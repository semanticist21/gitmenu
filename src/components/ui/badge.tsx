"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

// VS Code's count badge (base/browser/ui/countBadge/countBadge.css): 18px pill, 11px text,
// badge colors, no border. `long` is the squarer 2px-radius form.
export const badgeVariants = cva(
  "inline-block min-w-[18px] shrink-0 whitespace-nowrap text-center font-normal text-caption bg-badge text-badge-foreground",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        default: "min-h-[18px] rounded-badge px-[5px] py-[3px] leading-[11px]",
        long: "rounded-xs px-[3px] py-[2px] leading-[normal]",
      },
    },
  },
);

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
}

export function Badge({
  className,
  variant,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
