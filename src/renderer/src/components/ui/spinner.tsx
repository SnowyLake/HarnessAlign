import { LoaderCircleIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/Utils";

/** Animated progress indicator for pending actions. */
export function Spinner({ className, ...props }: ComponentProps<typeof LoaderCircleIcon>)
{
    return <LoaderCircleIcon data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />;
}
