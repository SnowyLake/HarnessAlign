import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/Utils";

/** Context-menu state root. */
function ContextMenu(props: ContextMenuPrimitive.Root.Props)
{
    return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

/** Element that opens a context menu. */
function ContextMenuTrigger(props: ContextMenuPrimitive.Trigger.Props)
{
    return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

/** Positioned context-menu popup. */
function ContextMenuContent({ className, sideOffset = 4, ...props }: ContextMenuPrimitive.Popup.Props & Pick<ContextMenuPrimitive.Positioner.Props, "sideOffset">)
{
    return (
        <ContextMenuPrimitive.Portal>
            <ContextMenuPrimitive.Positioner className="isolate z-50" sideOffset={sideOffset}>
                <ContextMenuPrimitive.Popup
                    data-slot="context-menu-content"
                    className={cn("min-w-40 origin-(--transform-origin) rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className)}
                    {...props}
                />
            </ContextMenuPrimitive.Positioner>
        </ContextMenuPrimitive.Portal>
    );
}

/** Semantic group of context-menu items. */
function ContextMenuGroup(props: ContextMenuPrimitive.Group.Props)
{
    return <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />;
}

/** Selectable context-menu command. */
function ContextMenuItem({ className, variant = "default", ...props }: ContextMenuPrimitive.Item.Props & { variant?: "default" | "destructive" })
{
    return (
        <ContextMenuPrimitive.Item
            data-slot="context-menu-item"
            data-variant={variant}
            className={cn("relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4", className)}
            {...props}
        />
    );
}

/** Visual separator between context-menu groups. */
function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props)
{
    return <ContextMenuPrimitive.Separator data-slot="context-menu-separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

/** Keyboard shortcut label aligned to a context-menu item. */
function ContextMenuShortcut({ className, ...props }: ComponentProps<"span">)
{
    return <span data-slot="context-menu-shortcut" className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props} />;
}

export { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger };
