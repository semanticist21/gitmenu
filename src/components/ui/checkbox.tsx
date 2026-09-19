"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import type React from "react";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

// VS Code's checkbox (base/browser/ui/toggle/toggle.css): 18px, 3px radius, checkbox colors,
// a `check` codicon when checked. Checking changes neither fill nor border, and nothing animates.
export function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props): React.ReactElement {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "relative inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-inset border border-checkbox-border bg-checkbox text-checkbox-foreground outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-focus data-disabled:cursor-default data-disabled:border-checkbox-disabled data-disabled:bg-checkbox-disabled data-disabled:text-checkbox-disabled-foreground",
        className,
      )}
      data-slot="checkbox"
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className="flex items-center justify-center data-unchecked:hidden"
        data-slot="checkbox-indicator"
        render={(
          indicatorProps: React.ComponentProps<"span">,
          state: CheckboxPrimitive.Indicator.State,
        ) => (
          <span {...indicatorProps}>
            <Icon name={state.indeterminate ? "remove" : "check"} />
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}

export { CheckboxPrimitive };
