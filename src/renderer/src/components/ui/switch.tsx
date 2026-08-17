import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/Utils";

/** Props for the Base UI switch primitive wrapper. */
export interface SwitchProps
{
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    className?: string;
}

/** Boolean switch bound to checked state. */
export function Switch({ checked, onCheckedChange, className }: SwitchProps)
{
    return (
        <SwitchPrimitive.Root
            checked={checked}
            onCheckedChange={onCheckedChange}
            className={cn(
                "relative inline-flex h-5 w-9 items-center rounded-full border border-border bg-muted data-[checked]:bg-primary",
                className,
            )}
        >
            <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-background transition-transform data-[checked]:translate-x-4" />
        </SwitchPrimitive.Root>
    );
}
