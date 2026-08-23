import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/Utils";

/** Root state container for a non-destructive dialog. */
export function Dialog(props: DialogPrimitive.Root.Props)
{
    return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/** Trigger that opens a dialog. */
export function DialogTrigger(props: DialogPrimitive.Trigger.Props)
{
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

/** Portal for dialog overlay content. */
export function DialogPortal(props: DialogPrimitive.Portal.Props)
{
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

/** Backdrop behind a dialog. */
export function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props)
{
    return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={cn("fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className)} {...props} />;
}

/** Centered dialog surface with a built-in close button. */
export function DialogContent({ className, children, showCloseButton = true, ...props }: DialogPrimitive.Popup.Props & { showCloseButton?: boolean })
{
    return (
        <DialogPortal>
            <DialogOverlay />
            <DialogPrimitive.Popup data-slot="dialog-content" className={cn("fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className)} {...props}>
                {children}
                {showCloseButton ? <DialogPrimitive.Close render={<Button size="icon-sm" variant="ghost" className="absolute top-3 right-3" />}><XIcon /><span className="sr-only">Close</span></DialogPrimitive.Close> : null}
            </DialogPrimitive.Popup>
        </DialogPortal>
    );
}

/** Heading region for dialog title and description. */
export function DialogHeader({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 pr-8", className)} {...props} />;
}

/** Footer region for dialog actions. */
export function DialogFooter({ className, ...props }: ComponentProps<"div">)
{
    return <div data-slot="dialog-footer" className={cn("-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end", className)} {...props} />;
}

/** Accessible dialog title. */
export function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props)
{
    return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-base font-semibold", className)} {...props} />;
}

/** Supporting dialog description. */
export function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props)
{
    return <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

/** Action that closes the dialog. */
export function DialogClose({ className, ...props }: DialogPrimitive.Close.Props)
{
    return <DialogPrimitive.Close data-slot="dialog-close" className={cn(className)} {...props} />;
}
