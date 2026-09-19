import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

// VS Code's welcome view (workbench/browser/parts/views/media/views.css): plain 13px
// paragraphs and full-width buttons (at most 300px) stacked 1em apart, padded 0 20px 1em.
// No illustration, icon box, card or heading.

export function Empty({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col items-center px-5 pb-[1em] text-(--vsc-foreground) text-[13px] *:mt-[1em] *:mb-0 [&>[data-slot=button]]:w-full [&>[data-slot=button]]:max-w-[300px] [&_a]:text-(--vsc-textLink-foreground) [&>p]:w-full",
        className,
      )}
      data-slot="empty"
      {...props}
    />
  );
}

export function EmptyHeader({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn("flex w-full flex-col gap-[1em]", className)}
      data-slot="empty-header"
      {...props}
    />
  );
}

const emptyMediaVariants = cva("hidden", {
  defaultVariants: { variant: "default" },
  variants: { variant: { default: "", icon: "" } },
});

/** Kept for API compatibility; welcome views have no illustration, so nothing renders. */
export function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof emptyMediaVariants>): React.ReactElement {
  return (
    <div
      aria-hidden
      className={cn(emptyMediaVariants({ variant }), className)}
      data-slot="empty-media"
      {...props}
    />
  );
}

export function EmptyTitle({
  className,
  ...props
}: React.ComponentProps<"p">): React.ReactElement {
  return (
    <p className={cn("w-full", className)} data-slot="empty-title" {...props} />
  );
}

export function EmptyDescription({
  className,
  ...props
}: React.ComponentProps<"p">): React.ReactElement {
  return (
    <p
      className={cn("w-full [&_a]:text-(--vsc-textLink-foreground)", className)}
      data-slot="empty-description"
      {...props}
    />
  );
}

export function EmptyContent({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-[300px] flex-col items-stretch gap-2 [&>[data-slot=button]]:w-full",
        className,
      )}
      data-slot="empty-content"
      {...props}
    />
  );
}
