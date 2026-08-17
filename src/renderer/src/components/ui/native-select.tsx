import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/Utils";

/** Native select styled to match other form controls. */
export function NativeSelect({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>)
{
    return (
        <select
            className={cn(
                "h-8 rounded-md border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring",
                className,
            )}
            {...props}
        />
    );
}
