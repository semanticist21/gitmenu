"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type * as React from "react";
import { Icon } from "@/components/Icon";
import {
  MenuItemContent,
  MenuShortcut,
  MenuSubmenuIndicator,
  menuCheckClassName,
  menuGroupLabelClassName,
  menuItemClassName,
  menuLabelClassName,
  menuPopupClassName,
  menuScrollClassName,
  menuSeparatorClassName,
} from "@/components/ui/menu";
import { cn } from "@/lib/utils";

// The same VS Code menu as `menu.tsx`, opened at the pointer.

export const ContextMenu: typeof ContextMenuPrimitive.Root =
  ContextMenuPrimitive.Root;

export const ContextMenuPortal: typeof ContextMenuPrimitive.Portal =
  ContextMenuPrimitive.Portal;

export function ContextMenuTrigger({
  className,
  children,
  ...props
}: ContextMenuPrimitive.Trigger.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.Trigger
      className={className}
      data-slot="context-menu-trigger"
      {...props}
    >
      {children}
    </ContextMenuPrimitive.Trigger>
  );
}

export function ContextMenuPopup({
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
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: ContextMenuPrimitive.Positioner.Props["alignOffset"];
  side?: ContextMenuPrimitive.Positioner.Props["side"];
  anchor?: ContextMenuPrimitive.Positioner.Props["anchor"];
  portalProps?: ContextMenuPrimitive.Portal.Props;
  /** Submenus open without the fade */
  submenu?: boolean;
}): React.ReactElement {
  return (
    <ContextMenuPortal {...portalProps}>
      <ContextMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-50"
        collisionPadding={4}
        data-slot="context-menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <ContextMenuPrimitive.Popup
          className={cn(
            menuPopupClassName,
            !submenu && "animate-menu-in",
            className,
          )}
          data-slot="context-menu-popup"
          {...props}
        >
          <div className={menuScrollClassName}>{children}</div>
        </ContextMenuPrimitive.Popup>
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPortal>
  );
}

export function ContextMenuGroup(
  props: ContextMenuPrimitive.Group.Props,
): React.ReactElement {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  );
}

export function ContextMenuItem({
  className,
  children,
  ...props
}: ContextMenuPrimitive.Item.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.Item
      className={cn(menuItemClassName, className)}
      data-slot="context-menu-item"
      {...props}
    >
      <MenuItemContent>{children}</MenuItemContent>
    </ContextMenuPrimitive.Item>
  );
}

export function ContextMenuLinkItem({
  className,
  children,
  closeOnClick = true,
  ...props
}: ContextMenuPrimitive.LinkItem.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.LinkItem
      className={cn(menuItemClassName, className)}
      closeOnClick={closeOnClick}
      data-slot="context-menu-link-item"
      {...props}
    >
      <MenuItemContent>{children}</MenuItemContent>
    </ContextMenuPrimitive.LinkItem>
  );
}

export function ContextMenuCheckboxItem({
  className,
  children,
  // VS Code menus close on every click, toggles included
  closeOnClick = true,
  ...props
}: ContextMenuPrimitive.CheckboxItem.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.CheckboxItem
      closeOnClick={closeOnClick}
      className={cn(menuItemClassName, className)}
      data-slot="context-menu-checkbox-item"
      {...props}
    >
      <ContextMenuPrimitive.CheckboxItemIndicator
        className={menuCheckClassName}
      >
        <Icon name="check" />
      </ContextMenuPrimitive.CheckboxItemIndicator>
      <MenuItemContent>{children}</MenuItemContent>
    </ContextMenuPrimitive.CheckboxItem>
  );
}

export function ContextMenuRadioGroup(
  props: ContextMenuPrimitive.RadioGroup.Props,
): React.ReactElement {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      {...props}
    />
  );
}

export function ContextMenuRadioItem({
  className,
  children,
  // VS Code menus close on every click, toggles included
  closeOnClick = true,
  ...props
}: ContextMenuPrimitive.RadioItem.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.RadioItem
      closeOnClick={closeOnClick}
      className={cn(menuItemClassName, className)}
      data-slot="context-menu-radio-item"
      {...props}
    >
      <ContextMenuPrimitive.RadioItemIndicator className={menuCheckClassName}>
        <Icon name="check" />
      </ContextMenuPrimitive.RadioItemIndicator>
      <MenuItemContent>{children}</MenuItemContent>
    </ContextMenuPrimitive.RadioItem>
  );
}

export function ContextMenuGroupLabel({
  className,
  ...props
}: ContextMenuPrimitive.GroupLabel.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.GroupLabel
      className={cn(menuGroupLabelClassName, className)}
      data-slot="context-menu-label"
      {...props}
    />
  );
}

export function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.Separator.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.Separator
      className={cn(menuSeparatorClassName, className)}
      data-slot="context-menu-separator"
      {...props}
    />
  );
}

/** Same component as `MenuShortcut`, so items recognise it as the keybinding column. */
export const ContextMenuShortcut = MenuShortcut;

export function ContextMenuSub(
  props: ContextMenuPrimitive.SubmenuRoot.Props,
): React.ReactElement {
  return (
    <ContextMenuPrimitive.SubmenuRoot data-slot="context-menu-sub" {...props} />
  );
}

export function ContextMenuSubTrigger({
  className,
  children,
  delay = 250,
  closeDelay = 750,
  ...props
}: ContextMenuPrimitive.SubmenuTrigger.Props): React.ReactElement {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      className={cn(menuItemClassName, className)}
      closeDelay={closeDelay}
      data-slot="context-menu-sub-trigger"
      delay={delay}
      {...props}
    >
      <span className={menuLabelClassName}>{children}</span>
      <MenuSubmenuIndicator />
    </ContextMenuPrimitive.SubmenuTrigger>
  );
}

export function ContextMenuSubPopup({
  className,
  sideOffset = 0,
  alignOffset,
  align = "start",
  ...props
}: ContextMenuPrimitive.Popup.Props & {
  align?: ContextMenuPrimitive.Positioner.Props["align"];
  sideOffset?: ContextMenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: ContextMenuPrimitive.Positioner.Props["alignOffset"];
}): React.ReactElement {
  return (
    <ContextMenuPopup
      align={align}
      alignOffset={alignOffset ?? -5}
      className={className}
      data-slot="context-menu-sub-content"
      side="inline-end"
      sideOffset={sideOffset}
      submenu
      {...props}
    />
  );
}

export { ContextMenuPrimitive };
