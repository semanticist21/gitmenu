"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

// VS Code's split button (button.css `.monaco-button-dropdown`): the main button loses its right
// border and right radius, a 1px separator line inset 4px sits on the button color, and the
// dropdown part is 4px-padded with a chevron. Buttons inside keep their own colors.
export const groupVariants = cva("flex w-fit", {
  defaultVariants: {
    orientation: "horizontal",
  },
  variants: {
    orientation: {
      horizontal:
        "items-stretch [&>button:not(:last-child)]:rounded-e-none [&>button:not(:last-child)]:border-e-0 [&>button:not(:first-child)]:rounded-s-none [&>button:not(:first-child)]:border-s-0 [&>button:not(:first-child)]:h-auto [&>button:not(:first-child)]:w-auto [&>button:not(:first-child)]:px-1 [&>button:focus-visible]:-outline-offset-1 [&:has(>button:disabled)>[data-slot=group-separator]]:opacity-40",
      vertical:
        "flex-col [&>button:not(:last-child)]:rounded-b-none [&>button:not(:first-child)]:rounded-t-none",
    },
  },
});

export function Group({
  className,
  orientation,
  children,
  ...props
}: {
  className?: string;
  orientation?: VariantProps<typeof groupVariants>["orientation"];
  children: React.ReactNode;
} & React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(groupVariants({ orientation }), className)}
      data-orientation={orientation}
      data-slot="group"
      role="group"
      {...props}
    >
      {children}
    </div>
  );
}

export function GroupText({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">): React.ReactElement {
  const defaultProps = {
    className: cn(
      "inline-flex items-center whitespace-nowrap border border-(--vsc-input-border) bg-(--vsc-input-background) px-1.5 text-[13px]",
      className,
    ),
    "data-slot": "group-text",
  };
  return useRender({
    defaultTagName: "div",
    props: mergeProps(defaultProps, props),
    render,
  });
}

/** The split button's separator: a 1px `button.separator` line inset 4px on the button color. */
export function GroupSeparator({
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children">): React.ReactElement {
  return (
    <div
      aria-hidden
      className={cn(
        "relative w-px shrink-0 border-(--vsc-button-border) border-y bg-(--vsc-button-background) py-1 before:block before:h-full before:w-px before:bg-(--vsc-button-separator)",
        className,
      )}
      data-slot="group-separator"
      {...props}
    />
  );
}

export {
  Group as ButtonGroup,
  GroupText as ButtonGroupText,
  GroupSeparator as ButtonGroupSeparator,
};
