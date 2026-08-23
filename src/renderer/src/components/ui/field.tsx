import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/Utils";

/** Field layout variants. */
const fieldVariants = cva("group/field flex w-full gap-3 data-[invalid=true]:text-destructive", {
    variants: {
        orientation: {
            vertical: "flex-col [&>*]:w-full [&>.sr-only]:w-auto",
            horizontal: "flex-row items-center [&>[data-slot=field-label]]:flex-auto has-[>[data-slot=field-content]]:items-start",
            responsive: "flex-col [&>*]:w-full [&>.sr-only]:w-auto @md/field-group:flex-row @md/field-group:items-center @md/field-group:[&>*]:w-auto @md/field-group:[&>[data-slot=field-content]]:flex-1",
        },
    },
    defaultVariants: { orientation: "vertical" },
});

/** Fieldset for related controls. */
export function FieldSet({ className, ...props }: ComponentProps<"fieldset">)
{
    return <fieldset data-slot="field-set" className={cn("flex flex-col gap-5", className)} {...props} />;
}

/** Legend for a related control group. */
export function FieldLegend({ className, variant = "legend", ...props }: ComponentProps<"legend"> & { variant?: "legend" | "label" })
{
    return <legend data-slot="field-legend" data-variant={variant} className={cn("mb-3 font-medium data-[variant=legend]:text-base data-[variant=label]:text-sm", className)} {...props} />;
}

/** Vertical group of form fields. */
export function FieldGroup({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="field-group" className={cn("@container/field-group flex w-full flex-col gap-5", className)} {...props} />;
}

/** One labeled form control and its supporting content. */
export function Field({ className, orientation = "vertical", ...props }: ComponentProps<"div"> & VariantProps<typeof fieldVariants>)
{
    return <div role="group" data-slot="field" data-orientation={orientation} className={cn(fieldVariants({ orientation }), className)} {...props} />;
}

/** Standard label for a field control. */
export function FieldLabel({ className, ...props }: ComponentProps<typeof Label>)
{
    return <Label data-slot="field-label" className={cn("w-fit group-data-[disabled=true]/field:opacity-50", className)} {...props} />;
}

/** Supporting description for a field. */
export function FieldDescription({ className, ...props }: ComponentProps<"p">)
{
    return <p data-slot="field-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Validation message for a field. */
export function FieldError({ className, children, errors, ...props }: ComponentProps<"div"> & { errors?: Array<{ message?: string } | undefined> })
{
    const content = children ?? errors?.map((error) => error?.message).filter(Boolean).join(", ");
    if (!content) return null;
    return <div role="alert" data-slot="field-error" className={cn("text-sm text-destructive", className)} {...props}>{content}</div>;
}

/** Text content aligned beside a field control. */
export function FieldContent({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="field-content" className={cn("flex min-w-0 flex-1 flex-col gap-1", className)} {...props} />;
}

/** Compact heading within field content. */
export function FieldTitle({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="field-title" className={cn("flex w-fit items-center gap-2 text-sm font-medium group-data-[disabled=true]/field:opacity-50", className)} {...props} />;
}

/** Labeled separator between field groups. */
export function FieldSeparator({ children, className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="field-separator" className={cn("relative -my-2 h-5 text-sm", className)} {...props}><Separator className="absolute inset-x-0 top-1/2" />{children ? <span className="relative mx-auto block w-fit bg-background px-2 text-muted-foreground">{children}</span> : null}</div>;
}
