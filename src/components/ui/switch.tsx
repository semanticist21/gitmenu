"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import type React from "react";
import { cn } from "@/lib/utils";

// VS Code's switch (switch.css): a 28x16 pill whose 12px thumb slides 12px; unchecked is
// descriptionForeground at 36%, checked is the button color. 120ms ease, none when reduced.
export function Switch({
  className,
  ...props
}: SwitchPrimitive.Root.Props): React.ReactElement {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border border-transparent bg-[color-mix(in_srgb,var(--vsc-descriptionForeground)_36%,transparent)] outline-none transition-[background-color,border-color] duration-120 ease-[ease] focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-(--vsc-focusBorder) motion-reduce:transition-none data-checked:border-(--vsc-button-background) data-checked:bg-(--vsc-button-background) data-disabled:cursor-default data-disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none absolute top-px left-px block size-3 rounded-full bg-(--vsc-button-foreground) transition-transform duration-120 ease-[ease] motion-reduce:transition-none data-checked:translate-x-3"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { SwitchPrimitive };
