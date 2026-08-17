import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/Utils";

/** Class-variance factory for button variant and size. */
const BUTTON_VARIANTS = cva(
    "inline-flex items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "border-transparent bg-primary text-primary-foreground hover:opacity-90",
                secondary: "border-border bg-card text-foreground hover:bg-accent",
                ghost: "border-transparent hover:bg-accent",
                destructive: "border-transparent bg-destructive text-white hover:opacity-90",
            },
            size: {
                default: "h-8 px-3",
                sm: "h-7 px-2.5",
                icon: "h-8 w-8",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

/** Props for the shared button primitive. */
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof BUTTON_VARIANTS>;

/** Styled button used across the desktop shell. */
export function Button({
    className,
    variant,
    size,
    type = "button",
    ...props
}: ButtonProps)
{
    return <button type={type} className={cn(BUTTON_VARIANTS({ variant, size }), className)} {...props} />;
}
