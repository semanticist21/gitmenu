"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import * as React from "react";
import { cn } from "@/lib/utils";

// VS Code's progress bar (base/browser/ui/progressbar/progressbar.css): a 2px track with a
// 2%-wide bit. Infinite progress slides the bit across in 4s (throttled to steps(100) after
// 10s); discrete progress grows its width in 100ms.

export function ProgressBar({
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** 0-100 for discrete progress; leave out for infinite */
  value?: number;
}): React.ReactElement {
  const infinite = value === undefined;
  const [longRunning, setLongRunning] = React.useState(false);
  React.useEffect(() => {
    if (!infinite) return;
    const timer = window.setTimeout(() => setLongRunning(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [infinite]);
  return (
    <div
      aria-valuemax={infinite ? undefined : 100}
      aria-valuemin={infinite ? undefined : 0}
      aria-valuenow={infinite ? undefined : value}
      className={cn("relative h-0.5 w-full overflow-hidden", className)}
      data-slot="progress-bar"
      role="progressbar"
      {...props}
    >
      <div
        className={cn(
          "absolute left-0 h-0.5 bg-progress",
          infinite
            ? "w-[2%] animate-progress"
            : "transition-[width] duration-fade ease-linear",
          infinite && longRunning && "[animation-timing-function:steps(100)]",
        )}
        style={infinite ? undefined : { width: `${value}%` }}
      />
    </div>
  );
}

export function Progress({
  className,
  children,
  ...props
}: ProgressPrimitive.Root.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Root
      className={cn("flex w-full flex-col gap-1", className)}
      data-slot="progress"
      {...props}
    >
      {children ? (
        children
      ) : (
        <ProgressTrack>
          <ProgressIndicator />
        </ProgressTrack>
      )}
    </ProgressPrimitive.Root>
  );
}

export function ProgressLabel({
  className,
  ...props
}: ProgressPrimitive.Label.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Label
      className={cn("text-ui", className)}
      data-slot="progress-label"
      {...props}
    />
  );
}

export function ProgressTrack({
  className,
  ...props
}: ProgressPrimitive.Track.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Track
      className={cn("relative block h-0.5 w-full overflow-hidden", className)}
      data-slot="progress-track"
      {...props}
    />
  );
}

export function ProgressIndicator({
  className,
  ...props
}: ProgressPrimitive.Indicator.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Indicator
      className={cn(
        "h-0.5 bg-progress transition-[width] duration-fade ease-linear",
        className,
      )}
      data-slot="progress-indicator"
      {...props}
    />
  );
}

export function ProgressValue({
  className,
  ...props
}: ProgressPrimitive.Value.Props): React.ReactElement {
  return (
    <ProgressPrimitive.Value
      className={cn("text-small tabular-nums", className)}
      data-slot="progress-value"
      {...props}
    />
  );
}

export { ProgressPrimitive };
