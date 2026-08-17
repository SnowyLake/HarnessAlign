import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";
import { cn } from "@/lib/Utils";

/** Horizontal or vertical divider. */
export function Separator({ className, orientation = "horizontal" }: { className?: string; orientation?: "horizontal" | "vertical" })
{
    return (
        <SeparatorPrimitive
            orientation={orientation}
            className={cn(orientation === "vertical" ? "h-full w-px bg-border" : "h-px w-full bg-border", className)}
        />
    );
}
