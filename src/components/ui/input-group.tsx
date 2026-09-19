"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Input, type InputProps } from "@/components/ui/input";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";

// VS Code's filter/search input (settings, keybindings, views): 24px with 12px text, no leading
// magnifier, inline actions (16px codicons) at the right edge.

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text select-none items-center justify-center gap-0.5 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      align: "inline-start",
    },
    variants: {
      align: {
        "block-end": "order-last w-full justify-start px-1.5 pb-1",
        "block-start": "order-first w-full justify-start px-1.5 pt-1",
        // Search icons in front of filter inputs are not a VS Code thing; interactive addons stay
        "inline-end": "order-last pe-0.5",
        "inline-start":
          "order-first ps-0.5 not-has-[button,a,input,select,[role=button]]:hidden",
      },
    },
  },
);

export function InputGroup({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "relative inline-flex h-6 w-full min-w-0 items-center rounded-[4px] border border-(--vsc-input-border) bg-(--vsc-input-background) text-(--vsc-input-foreground) text-[12px] has-[textarea]:h-auto has-data-[align=block-end]:h-auto has-data-[align=block-start]:h-auto has-data-[align=block-end]:flex-col has-data-[align=block-start]:flex-col has-[input:focus,textarea:focus]:outline-solid has-[input:focus,textarea:focus]:outline-1 has-[input:focus,textarea:focus]:-outline-offset-1 has-[input:focus,textarea:focus]:outline-(--vsc-focusBorder) has-aria-invalid:border-(--vsc-inputValidation-errorBorder) has-[input:disabled,textarea:disabled]:opacity-40 *:[[data-slot=input-control],[data-slot=textarea-control]]:contents **:[input]:h-[22px] **:[input]:py-[3px] **:[input]:text-[12px]",
        className,
      )}
      data-slot="input-group"
      role="group"
      {...props}
    />
  );
}

export function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof inputGroupAddonVariants>): React.ReactElement {
  return (
    <div
      className={cn(inputGroupAddonVariants({ align }), className)}
      data-align={align}
      data-slot="input-group-addon"
      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as Element;
        if (!e.currentTarget.contains(target)) return;

        const isInteractive = target.closest(
          "button, a, input, select, textarea, [role='button'], [role='combobox'], [role='listbox'], [data-slot='select-trigger']",
        );
        if (isInteractive) return;
        e.preventDefault();
        const parent = e.currentTarget.parentElement;
        const input = parent?.querySelector<
          HTMLInputElement | HTMLTextAreaElement
        >("input, textarea");
        if (input && !parent?.querySelector("input:focus, textarea:focus")) {
          input.focus();
        }
      }}
      {...props}
    />
  );
}

export function InputGroupText({
  className,
  ...props
}: React.ComponentProps<"span">): React.ReactElement {
  return (
    <span
      className={cn(
        "flex items-center gap-1 truncate [&_svg]:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export function InputGroupInput({
  className,
  ...props
}: InputProps): React.ReactElement {
  return <Input className={className} size="sm" unstyled {...props} />;
}

export function InputGroupTextarea({
  className,
  ...props
}: TextareaProps): React.ReactElement {
  return <Textarea className={className} unstyled {...props} />;
}
