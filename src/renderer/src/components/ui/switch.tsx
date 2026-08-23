import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@/lib/Utils";

/** Props for the Base UI switch primitive wrapper. */
export interface SwitchProps extends Omit<SwitchPrimitive.Root.Props, "checked" | "onCheckedChange">
{
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    className?: string;
}

/** Boolean switch bound to checked state. */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps)
{
    return (
        <SwitchPrimitive.Root
            checked={checked}
            onCheckedChange={onCheckedChange}
            {...props}
            className={cn(
                "peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs outline-none transition-all focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 data-[checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
        >
            <SwitchPrimitive.Thumb className="pointer-events-none block size-4 translate-x-0 rounded-full bg-background ring-0 transition-transform data-[checked]:translate-x-[calc(100%-2px)]" />
        </SwitchPrimitive.Root>
    );
}
