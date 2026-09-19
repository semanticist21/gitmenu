import type * as React from "react";
import { cn } from "@/lib/utils";

// VS Code's keybinding label (base/browser/ui/keybindingLabel/keybindingLabel.css): one
// 18px cap per macOS modifier in ⌃ ⇧ ⌥ ⌘ order, then the key, with a 6px gap between chords.

const MODIFIERS = ["⌃", "⇧", "⌥", "⌘"];

/** Splits `⌘⇧P ⌘K` into chords of caps, modifiers reordered to ⌃ ⇧ ⌥ ⌘. */
export function splitKeyLabel(label: string): string[][] {
  return label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((chord) => {
      const chars = Array.from(chord);
      const mods = chars.filter((c) => MODIFIERS.includes(c));
      const key = chars.filter((c) => !MODIFIERS.includes(c)).join("");
      mods.sort((a, b) => MODIFIERS.indexOf(a) - MODIFIERS.indexOf(b));
      return key ? [...mods, key] : mods;
    });
}

/** The plain-text form menus show: `⇧⌘P`, chords separated by a space. */
export function normalizeKeyLabel(label: string): string {
  return splitKeyLabel(label)
    .map((caps) => caps.join(""))
    .join(" ");
}

/** One key cap. */
export function Kbd({
  className,
  ...props
}: React.ComponentProps<"kbd">): React.ReactElement {
  return (
    <kbd
      className={cn(
        "pointer-events-none mx-0.5 inline-flex h-[18px] min-w-[24px] select-none items-center justify-center rounded-inset border border-keybinding-border border-b-keybinding-bottom-border bg-keybinding px-[5px] py-[3px] font-sans text-keybinding-foreground text-caption leading-[10px] shadow-key first:ms-0 last:me-0",
        className,
      )}
      data-slot="kbd"
      {...props}
    />
  );
}

/** Caps for one chord, as given by the caller. */
export function KbdGroup({
  className,
  ...props
}: React.ComponentProps<"span">): React.ReactElement {
  return (
    <span
      className={cn("inline-flex items-center leading-[10px]", className)}
      data-slot="kbd-group"
      {...props}
    />
  );
}

/** A whole keybinding (`⌘K ⌘S`) rendered as VS Code caps. */
export function Keybinding({
  value,
  className,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  value: string;
}): React.ReactElement {
  const chords = splitKeyLabel(value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-keybinding-foreground leading-[10px]",
        className,
      )}
      data-slot="keybinding"
      {...props}
    >
      {chords.map((caps, i) => (
        <KbdGroup key={i}>
          {caps.map((cap, j) => (
            <Kbd key={j}>{cap}</Kbd>
          ))}
        </KbdGroup>
      ))}
    </span>
  );
}
