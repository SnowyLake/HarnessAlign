import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/Utils";

/** Multiline text editor for rule and agent bodies. */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>)
{
    return (
        <textarea
            className={cn(
                "min-h-[clamp(10rem,36vh,32rem)] w-full max-w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring",
                className,
            )}
            {...props}
        />
    );
}
