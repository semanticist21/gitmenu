"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import * as React from "react";
import { Icon } from "@/components/Icon";
import { normalizeKeyLabel } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

// VS Code's context/dropdown menu (base/browser/ui/menu/menu.ts): 13px, 8px radius, 4px
// vertical padding, 24px items inset 4px with a 6px radius, label and keybinding padded 2em,
// a 2em check column, list.hoverBackground highlight, full-width separators. Opens with an
// 83ms opacity fade; closes and opens submenus instantly.

export const menuPopupClassName =
  "relative flex min-w-[160px] max-w-[calc(100vw-8px)] overflow-hidden rounded-[8px] border border-(--vsc-menu-border) bg-(--vsc-menu-background) text-[13px] text-(--vsc-menu-foreground) leading-[normal] outline-none [box-shadow:var(--vsc-shadow-lg)]";

export const menuScrollClassName =
  "max-h-[calc(var(--available-height)-8px)] w-full overflow-y-auto py-1 [&::-webkit-scrollbar]:size-[7px]";

export const menuItemClassName =
  "relative mx-1 flex h-6 cursor-default select-none items-center rounded-[6px] outline-none data-disabled:text-(--vsc-disabledForeground) data-highlighted:bg-(--vsc-list-hoverBackground) data-popup-open:bg-(--vsc-list-hoverBackground)";

export const menuLabelClassName =
  "min-w-0 flex-[1_1_auto] truncate px-[2em] leading-none";

export const menuCheckClassName =
  "absolute inset-y-0 left-0 flex w-[2em] items-center justify-center";

export const menuSeparatorClassName =
  "my-[5px] block h-0 border-(--vsc-menu-separatorBackground) border-b first:hidden last:hidden [[data-slot$=separator]+&]:hidden";

export const menuGroupLabelClassName =
  "block truncate px-[1em] pt-[.7em] pb-[.1em] font-bold";

export const Menu: typeof MenuPrimitive.Root = MenuPrimitive.Root;

export const MenuCreateHandle: typeof MenuPrimitive.createHandle =
  MenuPrimitive.createHandle;

export const MenuPortal: typeof MenuPrimitive.Portal = MenuPrimitive.Portal;

/** Keybindings as plain text (`⇧⌘P`), not key caps, right-aligned in their own column. */
export function MenuShortcut({
  className,
  children,
  ...props
}: React.ComponentProps<"span">): React.ReactElement {
  return (
    <span
      className={cn(
        "flex-[2_1_auto] shrink-0 whitespace-nowrap px-[2em] text-right leading-none opacity-70 in-data-disabled:opacity-40 in-data-highlighted:opacity-100",
        className,
      )}
      data-slot="menu-shortcut"
      {...props}
    >
      {typeof children === "string" ? normalizeKeyLabel(children) : children}
    </span>
  );
}

/** Splits an item's children into the label and a trailing `MenuShortcut`. */
export function splitMenuItemChildren(
  children: React.ReactNode,
): [React.ReactNode[], React.ReactNode[]] {
  const label: React.ReactNode[] = [];
  const trailing: React.ReactNode[] = [];
  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === MenuShortcut) {
      trailing.push(child);
    } else {
      label.push(child);
    }
  }
  return [label, trailing];
}

export function MenuItemContent({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [label, trailing] = splitMenuItemChildren(children);
  return (
    <>
      <span className={menuLabelClassName} data-slot="menu-label-text">
        {label}
      </span>
      {trailing}
    </>
  );
}

export function MenuTrigger({
  className,
  children,
  ...props
}: MenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.Trigger
      className={className}
      data-slot="menu-trigger"
      {...props}
    >
      {children}
    </MenuPrimitive.Trigger>
  );
}

export function MenuPopup({
  children,
  className,
  sideOffset = 0,
  align = "start",
  alignOffset,
  side = "bottom",
  anchor,
  portalProps,
  submenu = false,
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  portalProps?: MenuPrimitive.Portal.Props;
  /** Submenus open without the fade */
  submenu?: boolean;
}): React.ReactElement {
  return (
    <MenuPortal {...portalProps}>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        collisionPadding={4}
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn(
            menuPopupClassName,
            !submenu && "animate-[fadeIn_83ms_linear]",
            className,
          )}
          data-slot="menu-popup"
          {...props}
        >
          <div className={menuScrollClassName}>{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPortal>
  );
}

export function MenuGroup(
  props: MenuPrimitive.Group.Props,
): React.ReactElement {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

export function MenuItem({
  className,
  children,
  ...props
}: MenuPrimitive.Item.Props): React.ReactElement {
  return (
    <MenuPrimitive.Item
      className={cn(menuItemClassName, className)}
      data-slot="menu-item"
      {...props}
    >
      <MenuItemContent>{children}</MenuItemContent>
    </MenuPrimitive.Item>
  );
}

export function MenuLinkItem({
  className,
  children,
  closeOnClick = true,
  ...props
}: MenuPrimitive.LinkItem.Props): React.ReactElement {
  return (
    <MenuPrimitive.LinkItem
      className={cn(menuItemClassName, className)}
      closeOnClick={closeOnClick}
      data-slot="menu-link-item"
      {...props}
    >
      <MenuItemContent>{children}</MenuItemContent>
    </MenuPrimitive.LinkItem>
  );
}

export function MenuCheckboxItem({
  className,
  children,
  // VS Code menus close on every click, toggles included
  closeOnClick = true,
  ...props
}: MenuPrimitive.CheckboxItem.Props): React.ReactElement {
  return (
    <MenuPrimitive.CheckboxItem
      closeOnClick={closeOnClick}
      className={cn(menuItemClassName, className)}
      data-slot="menu-checkbox-item"
      {...props}
    >
      <MenuPrimitive.CheckboxItemIndicator className={menuCheckClassName}>
        <Icon name="check" />
      </MenuPrimitive.CheckboxItemIndicator>
      <MenuItemContent>{children}</MenuItemContent>
    </MenuPrimitive.CheckboxItem>
  );
}

export function MenuRadioGroup(
  props: MenuPrimitive.RadioGroup.Props,
): React.ReactElement {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  // VS Code menus close on every click, toggles included
  closeOnClick = true,
  ...props
}: MenuPrimitive.RadioItem.Props): React.ReactElement {
  return (
    <MenuPrimitive.RadioItem
      closeOnClick={closeOnClick}
      className={cn(menuItemClassName, className)}
      data-slot="menu-radio-item"
      {...props}
    >
      <MenuPrimitive.RadioItemIndicator className={menuCheckClassName}>
        <Icon name="check" />
      </MenuPrimitive.RadioItemIndicator>
      <MenuItemContent>{children}</MenuItemContent>
    </MenuPrimitive.RadioItem>
  );
}

export function MenuGroupLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props): React.ReactElement {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(menuGroupLabelClassName, className)}
      data-slot="menu-label"
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <MenuPrimitive.Separator
      className={cn(menuSeparatorClassName, className)}
      data-slot="menu-separator"
      {...props}
    />
  );
}

export function MenuSub(
  props: MenuPrimitive.SubmenuRoot.Props,
): React.ReactElement {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

/** The submenu indicator: `chevron-right` in a 1.8em-padded column (menu.ts). */
export function MenuSubmenuIndicator(): React.ReactElement {
  return (
    <span className="flex h-full flex-[2_1_auto] items-center justify-end ps-[1.8em] pe-[calc(1.8em-20px)] opacity-70 in-data-disabled:opacity-40">
      <Icon name="chevron-right" />
    </span>
  );
}

export function MenuSubTrigger({
  className,
  children,
  delay = 250,
  closeDelay = 750,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props): React.ReactElement {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(menuItemClassName, className)}
      closeDelay={closeDelay}
      data-slot="menu-sub-trigger"
      delay={delay}
      {...props}
    >
      <span className={menuLabelClassName}>{children}</span>
      <MenuSubmenuIndicator />
    </MenuPrimitive.SubmenuTrigger>
  );
}

export function MenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
}): React.ReactElement {
  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? -5}
      className={className}
      data-slot="menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      submenu
      {...props}
    />
  );
}

export {
  MenuPrimitive,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu as DropdownMenu,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup as DropdownMenuContent,
  MenuGroup as DropdownMenuGroup,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup as DropdownMenuSubContent,
};
