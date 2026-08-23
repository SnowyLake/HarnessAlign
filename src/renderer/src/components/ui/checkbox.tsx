import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/Utils";

/** Base UI checkbox that preserves native form submission semantics. */
export function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props)
{
    return (
        <CheckboxPrimitive.Root
            data-slot="checkbox"
            className={cn("peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background shadow-xs outline-none transition-colors after:absolute after:-inset-x-2 after:-inset-y-1 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50", className)}
            {...props}
        >
            <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="flex items-center justify-center text-current">
                <CheckIcon />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}
