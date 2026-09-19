import type React from "react";
import { Icon } from "@/components/Icon";

/** VS Code's progress glyph: codicon `loading` spinning in 30 steps per 1.5s. */
export function Spinner({
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children">): React.ReactElement {
  return (
    <Icon
      aria-label="Loading"
      className={className}
      name="loading"
      role="status"
      spin
      {...props}
    />
  );
}
