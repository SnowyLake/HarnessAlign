import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/Utils";

/** Shared badge visual variants. */
const badgeVariants = cva("inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3", {
    variants: {
        variant: {
            default: "border-transparent bg-primary text-primary-foreground",
            secondary: "border-transparent bg-secondary text-secondary-foreground",
            destructive: "border-transparent bg-destructive/10 text-destructive",
            outline: "border-border text-foreground",
            ghost: "border-transparent hover:bg-muted hover:text-foreground",
        },
    },
    defaultVariants: { variant: "default" },
});

/** Compact semantic status label. */
export function Badge({ className, variant, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>)
{
    return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
