import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/Utils";

/** Shared surface and density variants for content-list rows. */
const itemVariants = cva(
    "group/item flex items-center rounded-lg border border-transparent text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    {
        variants: {
            variant: {
                default: "bg-transparent",
                outline: "border-border",
                muted: "bg-muted/50",
            },
            size: {
                default: "gap-4 p-4",
                sm: "gap-2.5 px-3 py-2.5",
            },
        },
        defaultVariants: { variant: "default", size: "default" },
    },
);

/** Content-list row with shared size and surface variants. */
function Item({ className, variant, size, ...props }: ComponentProps<"div"> & VariantProps<typeof itemVariants>)
{
    return <div data-slot="item" data-variant={variant} data-size={size} className={cn(itemVariants({ variant, size }), className)} {...props} />;
}

/** Vertical collection of item rows. */
function ItemGroup({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="item-group" className={cn("group/item-group flex flex-col", className)} {...props} />;
}

/** Primary flexible content column inside an item. */
function ItemContent({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="item-content" className={cn("flex min-w-0 flex-1 flex-col gap-1", className)} {...props} />;
}

/** Leading media region inside an item. */
function ItemMedia({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="item-media" className={cn("flex shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4", className)} {...props} />;
}

/** Primary item label. */
function ItemTitle({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="item-title" className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", className)} {...props} />;
}

/** Supporting item text. */
function ItemDescription({ className, ...props }: ComponentProps<"p">)
{
    return <p data-slot="item-description" className={cn("line-clamp-2 text-sm text-muted-foreground", className)} {...props} />;
}

/** Trailing action region inside an item. */
function ItemActions({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="item-actions" className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}

/** Separator aligned to item content. */
function ItemSeparator({ className, ...props }: ComponentProps<typeof Separator>)
{
    return <Separator data-slot="item-separator" className={cn("my-0", className)} {...props} />;
}

export { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle, itemVariants };
