"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "@/lib/utils";

// VS Code's input box (base/browser/ui/inputbox/inputBox.css): 26px, 4px radius, input.border,
// padding 4px 6px, 13px text with an ellipsis. Focus draws a 1px focusBorder outline over
// the border (offset -1px); validation swaps the border color. No ring, no shadow.

export const inputBoxClassName =
  "relative inline-flex w-full rounded-control border border-input-border bg-input-background text-input-foreground text-ui has-[input:focus,textarea:focus]:outline-solid has-[input:focus,textarea:focus]:outline-1 has-[input:focus,textarea:focus]:-outline-offset-1 has-[input:focus,textarea:focus]:outline-focus has-aria-invalid:border-validation-error-border has-aria-invalid:outline-validation-error-border has-disabled:opacity-40";

export type InputProps = Omit<
  InputPrimitive.Props & React.RefAttributes<HTMLInputElement>,
  "size"
> & {
  /** `sm` is the 24px/12px filter input VS Code uses in views and editors */
  size?: "sm" | "default" | "lg" | number;
  unstyled?: boolean;
  nativeInput?: boolean;
};

export function Input({
  className,
  size = "default",
  unstyled = false,
  nativeInput = false,
  style,
  ...props
}: InputProps): React.ReactElement {
  const inputClassName = cn(
    "h-6 w-full min-w-0 rounded-[inherit] bg-transparent px-1.5 py-1 text-inherit text-ellipsis leading-4 outline-none focus:outline-none autofill:[-webkit-text-fill-color:--theme(--color-input-foreground)]",
    size === "sm" && "h-control-sm py-[3px] text-small",
    props.type === "search" &&
      "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none [&::-webkit-search-results-button]:appearance-none [&::-webkit-search-results-decoration]:appearance-none",
    props.type === "file" &&
      "file:me-3 file:bg-transparent file:text-inherit file:text-ui",
  );

  return (
    <span
      className={
        cn(!unstyled && inputBoxClassName, className) || undefined
      }
      data-size={size}
      data-slot="input-control"
    >
      {nativeInput ? (
        <input
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={typeof style === "function" ? undefined : style}
          {...props}
        />
      ) : (
        <InputPrimitive
          className={inputClassName}
          data-slot="input"
          size={typeof size === "number" ? size : undefined}
          style={style}
          {...props}
        />
      )}
    </span>
  );
}

export { InputPrimitive };
