"use client";

import * as React from "react";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { NOTIFICATION_MARGIN } from "@/theme/metrics";

// VS Code notification toasts (workbench/browser/parts/notifications): bottom-right, newest on
// top, at most 3 on screen with the rest waiting, 4px-radius boxes with a severity codicon, the
// message wrapping in full (gitmenu never truncates it), actions as 26px buttons (first
// primary), a close action on hover. Auto-hide after 10s/12s/15s only while the window is
// focused and the toast is neither hovered nor focused; errors with actions and toasts with
// progress stay. They slide up 300ms on show and disappear at once.

export type ToastType = "info" | "warning" | "error" | "success" | "loading";
export type NotificationSeverity = "info" | "warning" | "error";

export interface ToastAction
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
}

export interface ToastOptions {
  id?: string;
  /** `success` shows as info (VS Code has no success severity); `loading` adds progress */
  type?: ToastType | (string & {});
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Milliseconds; `0` keeps the toast until it is closed */
  timeout?: number;
  /** The primary action. Clicking an action closes the toast unless its handler calls `preventDefault()`. */
  actionProps?: ToastAction;
  /** Actions after the primary one, shown as secondary buttons */
  actions?: ToastAction[];
  /** Called once when the toast goes away for any reason other than an identical toast replacing it */
  onClose?: () => void;
  onRemove?: () => void;
  priority?: "low" | "high";
  data?: unknown;
}

export interface ToastObject extends ToastOptions {
  id: string;
}

const MAX_VISIBLE = 3;
const SPAM_INTERVAL = 800;
const PURGE_TIMEOUT: Record<NotificationSeverity, number> = {
  error: 15_000,
  info: 10_000,
  warning: 12_000,
};

export function toastSeverity(type: string | undefined): NotificationSeverity {
  if (type === "error") return "error";
  if (type === "warning") return "warning";
  return "info";
}

function toastActions(toast: ToastOptions): ToastAction[] {
  return [
    ...(toast.actionProps ? [toast.actionProps] : []),
    ...(toast.actions ?? []),
  ];
}

function isSticky(toast: ToastObject): boolean {
  return (
    toast.timeout === 0 ||
    toast.type === "loading" ||
    (toastSeverity(toast.type) === "error" && toastActions(toast).length > 0)
  );
}

interface Entry {
  timer?: number;
  hovered: boolean;
  focused: boolean;
  waitingForFocus: boolean;
}

let toasts: ToastObject[] = []; // newest first
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let recentAdds: number[] = [];
let counter = 0;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): ToastObject[] {
  return toasts;
}

function schedule(id: string) {
  const entry = entries.get(id);
  const toast = toasts.find((t) => t.id === id);
  if (!entry || !toast) return;
  window.clearTimeout(entry.timer);
  const delay =
    toast.timeout && toast.timeout > 0
      ? toast.timeout
      : PURGE_TIMEOUT[toastSeverity(toast.type)];
  entry.timer = window.setTimeout(() => {
    const current = toasts.find((t) => t.id === id);
    if (!current || !entries.has(id)) return;
    // Never hide while the window is in the background: wait for it to come back
    if (!document.hasFocus()) {
      if (!entry.waitingForFocus) {
        entry.waitingForFocus = true;
        const onFocus = () => {
          window.removeEventListener("focus", onFocus);
          entry.waitingForFocus = false;
          schedule(id);
        };
        window.addEventListener("focus", onFocus);
      }
      return;
    }
    if (isSticky(current) || entry.hovered || entry.focused) {
      schedule(id);
      return;
    }
    remove(id);
  }, delay);
}

function remove(id: string, notify = true) {
  const toast = toasts.find((t) => t.id === id);
  if (!toast) return;
  const entry = entries.get(id);
  if (entry) window.clearTimeout(entry.timer);
  entries.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
  if (notify) toast.onClose?.();
  toast.onRemove?.();
}

function sameContent(a: ToastOptions, b: ToastOptions): boolean {
  return (
    toastSeverity(a.type) === toastSeverity(b.type) &&
    typeof a.title === "string" &&
    a.title === b.title &&
    (a.description ?? "") === (b.description ?? "") &&
    toastActions(a).length === 0 &&
    toastActions(b).length === 0
  );
}

function add(options: ToastOptions): string {
  const id = options.id ?? `toast-${++counter}`;
  const now = Date.now();
  // VS Code drops a burst of more than 3 toasts in 800ms
  recentAdds = recentAdds.filter((time) => now - time < SPAM_INTERVAL);
  recentAdds.push(now);
  if (recentAdds.length > MAX_VISIBLE) return id;
  // An identical toast is replaced by the new one on top
  for (const duplicate of toasts.filter(
    (t) => t.id === id || sameContent(t, options),
  )) {
    remove(duplicate.id, false);
  }
  toasts = [{ ...options, id }, ...toasts];
  entries.set(id, { focused: false, hovered: false, waitingForFocus: false });
  emit();
  schedule(id);
  return id;
}

function close(id?: string) {
  if (id === undefined) {
    for (const toast of [...toasts]) remove(toast.id);
    return;
  }
  remove(id);
}

function update(id: string, options: Partial<ToastOptions>) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, ...options, id } : t));
  emit();
  schedule(id);
}

async function promise<T>(
  value: Promise<T>,
  options: {
    loading: ToastOptions | string;
    success: ToastOptions | string | ((result: T) => ToastOptions | string);
    error: ToastOptions | string | ((error: unknown) => ToastOptions | string);
  },
): Promise<T> {
  const asOptions = (o: ToastOptions | string): ToastOptions =>
    typeof o === "string" ? { title: o } : o;
  const id = add({ ...asOptions(options.loading), type: "loading" });
  try {
    const result = await value;
    const next =
      typeof options.success === "function"
        ? options.success(result)
        : options.success;
    update(id, { type: "success", ...asOptions(next) });
    return result;
  } catch (error) {
    const next =
      typeof options.error === "function" ? options.error(error) : options.error;
    update(id, { type: "error", ...asOptions(next) });
    throw error;
  }
}

export const toastManager = { add, close, promise, update };

function setInteraction(id: string, key: "hovered" | "focused", value: boolean) {
  const entry = entries.get(id);
  if (entry) entry[key] = value;
}

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  error: "text-notification-error",
  info: "text-notification-info",
  warning: "text-notification-warning",
};

export interface NotificationCardProps
  extends Omit<React.ComponentProps<"div">, "title"> {
  severity: NotificationSeverity;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: ToastAction[];
  /** Called after an action ran, unless its handler called `preventDefault()` */
  onActionDone?: () => void;
  /** Shows the close action (on hover or focus) */
  onClose?: () => void;
  closeLabel?: string;
  progress?: boolean;
}

/** One VS Code notification: severity icon, wrapping message, close action, buttons. */
export function NotificationCard({
  severity,
  title,
  description,
  actions = [],
  onActionDone,
  onClose,
  closeLabel = "Clear Notification",
  progress = false,
  className,
  ...props
}: NotificationCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "group/notification relative rounded-control border border-notification-border bg-notification text-notification-foreground shadow-widget",
        className,
      )}
      data-severity={severity}
      data-slot="notification"
      {...props}
    >
      <div className="flex flex-col px-[5px] py-2.5">
        <div className="flex">
          <Icon
            className={cn(
              "mx-1 flex h-row flex-[0_0_16px] items-center justify-center text-[18px]",
              SEVERITY_COLOR[severity],
            )}
            name={severity}
          />
          <div
            className="max-h-[calc(100vh-80px)] min-w-0 flex-1 select-text overflow-y-auto whitespace-normal text-small leading-row [overflow-wrap:anywhere] min-[480px]:text-ui [&_a]:text-notification-link"
            data-slot="notification-message"
          >
            {title}
            {description != null && description !== "" && (
              <span className="block">{description}</span>
            )}
          </div>
          {onClose && !progress && (
            <div className="hidden h-row shrink-0 group-focus-within/notification:block group-hover/notification:block">
              <Button
                aria-label={closeLabel}
                className="mr-1"
                onClick={onClose}
                size="icon"
                variant="action"
              >
                <Icon name="close" />
              </Button>
            </div>
          )}
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center justify-end pl-[5px]">
            {actions.map(({ children, onClick, className: actionClass, ...action }, i) => (
              <Button
                key={i}
                className={cn("mx-[5px] my-1 w-fit min-w-0 max-w-full", actionClass)}
                title={typeof children === "string" ? children : undefined}
                variant={i === 0 ? "primary" : "secondary"}
                {...action}
                onClick={(event) => {
                  onClick?.(event);
                  if (!event.defaultPrevented) onActionDone?.();
                }}
              >
                <span className="truncate">{children}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
      {progress && (
        <ProgressBar className="absolute inset-x-0 bottom-0 overflow-hidden rounded-b-control" />
      )}
    </div>
  );
}

function ToastView({ toast }: { toast: ToastObject }): React.ReactElement {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const severity = toastSeverity(toast.type);
  return (
    <NotificationCard
      actions={toastActions(toast)}
      className={cn(
        "pointer-events-auto m-1 w-[min(450px,calc(100vw-16px))] shrink-0 transition-[translate,opacity] duration-300 ease-out motion-reduce:duration-0",
        shown ? "translate-y-0 opacity-100" : "translate-y-full opacity-0",
      )}
      data-type={toast.type}
      description={toast.description}
      onActionDone={() => close(toast.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setInteraction(toast.id, "focused", false);
        }
      }}
      onClose={() => close(toast.id)}
      onFocus={() => setInteraction(toast.id, "focused", true)}
      onMouseEnter={() => setInteraction(toast.id, "hovered", true)}
      onMouseLeave={() => setInteraction(toast.id, "hovered", false)}
      progress={toast.type === "loading"}
      role={severity === "info" ? "status" : "alert"}
      severity={severity}
      title={toast.title}
    />
  );
}

/** Sum of the heights of bars pinned to the window bottom (`data-bottom-bar`), like OpsBar. */
function useBottomBarInset(active: boolean): number {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      let height = 0;
      for (const bar of document.querySelectorAll<HTMLElement>(
        "[data-bottom-bar]",
      )) {
        height += bar.getBoundingClientRect().height;
      }
      setInset(height);
    };
    const request = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new MutationObserver(request);
    observer.observe(document.body, { childList: true, subtree: true });
    request();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [active]);
  return inset;
}

function Toasts(): React.ReactElement | null {
  const all = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // The oldest three are on screen; newer ones wait until one of them goes away
  const visible = all.slice(-MAX_VISIBLE);
  const inset = useBottomBarInset(visible.length > 0);
  if (visible.length === 0) return null;
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-notification-margin z-40 flex flex-col items-end"
      data-slot="toast-viewport"
      style={{ bottom: NOTIFICATION_MARGIN + inset, maxHeight: `calc(100vh - ${2 * NOTIFICATION_MARGIN + inset}px)` }}
    >
      {visible.map((toast) => (
        <ToastView key={toast.id} toast={toast} />
      ))}
    </section>
  );
}

export function ToastProvider({
  children,
}: {
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <>
      {children}
      <Toasts />
    </>
  );
}
