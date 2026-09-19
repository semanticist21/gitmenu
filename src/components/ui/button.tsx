"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

// VS Code buttons (base/browser/ui/button/button.css, actionbar.css): 26px text buttons with a
// 4px radius, blue primary, gray secondary, and 22px/20px icon "action" buttons with a 6px
// radius. No transitions, shadows or scale. Legacy coss names map onto these so existing
// callers keep compiling: default/destructive -> primary, outline -> secondary,
// ghost -> action, sm/lg/xl -> default, xs -> small, icon-xs -> icon-sm.
const primary =
  "border-(--vsc-button-border) bg-(--vsc-button-background) text-(--vsc-button-foreground) not-disabled:hover:bg-(--vsc-button-hoverBackground) focus-visible:bg-(--vsc-button-hoverBackground) data-popup-open:bg-(--vsc-button-hoverBackground)";
const secondary =
  "border-(--vsc-button-secondaryBorder) bg-(--vsc-button-secondaryBackground) text-(--vsc-button-secondaryForeground) not-disabled:hover:bg-(--vsc-button-secondaryHoverBackground) focus-visible:bg-(--vsc-button-secondaryHoverBackground) data-popup-open:bg-(--vsc-button-secondaryHoverBackground)";
const action =
  "border-transparent bg-transparent text-inherit not-disabled:hover:bg-(--vsc-toolbar-hoverBackground) data-popup-open:bg-(--vsc-toolbar-hoverBackground) aria-pressed:bg-(--vsc-toolbar-activeBackground) not-disabled:active:bg-(--vsc-toolbar-activeBackground) focus-visible:-outline-offset-1 disabled:text-(--vsc-disabledForeground) disabled:opacity-100";
const link =
  "h-auto border-transparent bg-transparent p-0 text-(--vsc-textLink-foreground) hover:text-(--vsc-textLink-activeForeground) hover:underline";

const text = "h-[26px] rounded-[4px] px-2 py-1 text-[12px] leading-4";
const small = "h-[22px] rounded-[4px] px-1.5 py-[3px] text-[11px] leading-[14px]";
const icon = "size-[22px] rounded-[6px] p-0";
const iconSmall = "size-5 rounded-[6px] p-0";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center whitespace-nowrap border font-normal outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--vsc-focusBorder) disabled:cursor-default disabled:opacity-40 data-loading:select-none data-loading:text-transparent [&>.codicon]:mx-[.2em] [&>svg]:mx-[.2em] [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    compoundVariants: [
      // Icon-only buttons are action buttons whatever variant they were given in a toolbar
      { class: "[&>.codicon]:mx-0 [&>svg]:mx-0", size: ["icon", "icon-sm", "icon-xs", "icon-lg", "icon-xl"] },
    ],
    defaultVariants: {
      size: "default",
      variant: "primary",
    },
    variants: {
      size: {
        default: text,
        small,
        short: "h-[28px] flex-wrap rounded-[4px] px-1 py-0 text-[12px] leading-[18px]",
        icon,
        "icon-sm": iconSmall,
        // legacy names
        sm: text,
        lg: text,
        xl: text,
        xs: small,
        "icon-lg": icon,
        "icon-xl": icon,
        "icon-xs": iconSmall,
      },
      variant: {
        primary,
        secondary,
        action,
        link,
        // legacy names
        default: primary,
        destructive: primary,
        outline: secondary,
        "destructive-outline": secondary,
        ghost: action,
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute text-(--vsc-button-foreground)"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
