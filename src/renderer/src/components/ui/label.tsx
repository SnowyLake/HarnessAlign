import type { LabelHTMLAttributes } from "react";
import { cn } from "@/lib/Utils";

/** Styled label that stacks a caption above its control. */
export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>)
{
    return <label className={cn("grid gap-1 text-[12px] text-muted-foreground", className)} {...props} />;
}
