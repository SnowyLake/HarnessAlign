import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/Utils";

/** Position and spacing variants for input-group addons. */
const inputGroupAddonVariants = cva(
    "flex cursor-text items-center justify-center gap-2 text-sm font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-4",
    {
        variants: {
            align: {
                "inline-start": "order-first pl-2.5",
                "inline-end": "order-last pr-2.5",
                "block-start": "order-first w-full justify-start px-3 pt-2.5",
                "block-end": "order-last w-full justify-start px-3 pb-2.5",
            },
        },
        defaultVariants: { align: "inline-start" },
    },
);

/** Shared shell for an input and its inline addons. */
function InputGroup({ className, ...props }: ComponentProps<"div">)
{
    return (
        <div
            data-slot="input-group"
            role="group"
            className={cn(
                "group/input-group relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-transparent outline-none transition-colors has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot=input-group-control][aria-invalid=true]]:border-destructive has-[[data-slot=input-group-control][aria-invalid=true]]:ring-3 has-[[data-slot=input-group-control][aria-invalid=true]]:ring-destructive/20 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
                className,
            )}
            {...props}
        />
    );
}

/** Borderless input control owned by an input group. */
function InputGroupInput({ className, ...props }: ComponentProps<typeof Input>)
{
    return <Input className={cn("h-full flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0", className)} data-slot="input-group-control" {...props} />;
}

/** Inline or block content adjacent to an input-group control. */
function InputGroupAddon({ className, align = "inline-start", ...props }: ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>)
{
    return (
        <div
            data-slot="input-group-addon"
            data-align={align}
            className={cn(inputGroupAddonVariants({ align }), className)}
            onClick={(event) =>
            {
                if ((event.target as HTMLElement).closest("button")) return;
                event.currentTarget.parentElement?.querySelector<HTMLInputElement>("input")?.focus();
            }}
            {...props}
        />
    );
}

export { InputGroup, InputGroupAddon, InputGroupInput, inputGroupAddonVariants };
