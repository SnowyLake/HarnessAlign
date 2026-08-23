import type { ComponentProps } from "react";
import { cn } from "@/lib/Utils";

/** Card surface with shared spacing and size variants. */
export function Card({ className, size = "default", ...props }: ComponentProps<"div"> & { size?: "default" | "sm" })
{
    return <div data-slot="card" data-size={size} className={cn("group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground shadow-xs ring-1 ring-foreground/10 [--card-spacing:1rem] data-[size=sm]:[--card-spacing:0.75rem]", className)} {...props} />;
}

/** Heading area for a card. */
export function CardHeader({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="card-header" className={cn("grid auto-rows-min grid-cols-[1fr_auto] items-start gap-1 px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto]", className)} {...props} />;
}

/** Primary card heading. */
export function CardTitle({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="card-title" className={cn("col-start-1 min-w-0 text-base font-medium group-data-[size=sm]/card:text-sm", className)} {...props} />;
}

/** Supporting card text. */
export function CardDescription({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="card-description" className={cn("col-start-1 text-sm text-muted-foreground", className)} {...props} />;
}

/** Action aligned with the card heading. */
export function CardAction({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
}

/** Main card content area. */
export function CardContent({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />;
}

/** Footer area for card actions. */
export function CardFooter({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="card-footer" className={cn("flex items-center px-(--card-spacing) group-data-[size=sm]/card:gap-1.5", className)} {...props} />;
}
