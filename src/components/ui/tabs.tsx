"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type * as React from "react";
import { cn } from "@/lib/utils";

// VS Code's editor tabs (multieditortabscontrol.css): a 35px strip on the tabs background, square
// 120px tabs separated by 1px borders, the active tab lifted with a 1px top bar. `underline` is
// the Settings editor's scope tabs (User/Workspace). Nothing animates.

type TabsVariant = "default" | "underline";

export function Tabs({
  className,
  ...props
}: TabsPrimitive.Root.Props): React.ReactElement {
  return (
    <TabsPrimitive.Root
      className={cn(
        "flex flex-col data-[orientation=vertical]:flex-row",
        className,
      )}
      data-slot="tabs"
      {...props}
    />
  );
}

export function TabsList({
  variant = "default",
  className,
  ...props
}: TabsPrimitive.List.Props & {
  variant?: TabsVariant;
}): React.ReactElement {
  return (
    <TabsPrimitive.List
      className={cn(
        "relative flex min-w-0 data-[orientation=vertical]:flex-col",
        variant === "default"
          ? "h-[35px] shrink-0 overflow-x-auto overflow-y-hidden bg-(--vsc-editorGroupHeader-tabsBackground) shadow-[inset_0_-1px_0_var(--vsc-editorGroupHeader-tabsBorder)] [&::-webkit-scrollbar]:h-[3px]"
          : "gap-0",
        className,
      )}
      data-slot="tabs-list"
      data-variant={variant}
      {...props}
    />
  );
}

export function TabsTab({
  className,
  ...props
}: TabsPrimitive.Tab.Props): React.ReactElement {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "relative flex shrink-0 cursor-pointer items-center whitespace-nowrap text-[13px] outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--vsc-focusBorder) data-disabled:cursor-default data-disabled:opacity-40",
        // editor tab
        "in-data-[variant=default]:h-[35px] in-data-[variant=default]:w-[120px] in-data-[variant=default]:min-w-fit in-data-[variant=default]:border-(--vsc-tab-border) in-data-[variant=default]:border-r in-data-[variant=default]:bg-(--vsc-tab-inactiveBackground) in-data-[variant=default]:pr-2 in-data-[variant=default]:pl-2.5 in-data-[variant=default]:text-(--vsc-tab-inactiveForeground) in-data-[variant=default]:leading-[35px] in-data-[variant=default]:hover:bg-(--vsc-tab-hoverBackground) in-data-[variant=default]:data-active:bg-(--vsc-tab-activeBackground) in-data-[variant=default]:data-active:text-(--vsc-tab-activeForeground) in-data-[variant=default]:data-active:shadow-[inset_0_1px_0_var(--vsc-tab-activeBorderTop),inset_0_-1px_0_var(--vsc-tab-activeBorder)]",
        // settings scope tab
        "in-data-[variant=underline]:border-transparent in-data-[variant=underline]:border-b in-data-[variant=underline]:px-2 in-data-[variant=underline]:pt-[7px] in-data-[variant=underline]:pb-[6.5px] in-data-[variant=underline]:opacity-90 in-data-[variant=underline]:data-active:border-(--vsc-settings-headerForeground) in-data-[variant=underline]:data-active:text-(--vsc-settings-headerForeground) in-data-[variant=underline]:data-active:opacity-100",
        className,
      )}
      data-slot="tabs-tab"
      {...props}
    />
  );
}

export function TabsPanel({
  className,
  ...props
}: TabsPrimitive.Panel.Props): React.ReactElement {
  return (
    <TabsPrimitive.Panel
      className={cn("min-h-0 flex-1 outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export {
  TabsPrimitive,
  TabsTab as TabsTrigger,
  TabsPanel as TabsContent,
  type TabsVariant,
};
