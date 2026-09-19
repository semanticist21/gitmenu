import type React from "react";
import { cn } from "@/lib/utils";

/** A static placeholder block: VS Code shows no shimmering skeletons. */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("bg-(--vsc-list-hoverBackground)", className)}
      data-slot="skeleton"
      {...props}
    />
  );
}
