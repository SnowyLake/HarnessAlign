import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/Utils";

/** Styled text input. */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>)
{
    return (
        <input
            className={cn(
                "h-8 w-full rounded-md border border-border bg-background px-2.5 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring",
                className,
            )}
            {...props}
        />
    );
}
