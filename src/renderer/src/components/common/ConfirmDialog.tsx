import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Props for the thin confirm wrapper around AlertDialog. */
export interface ConfirmDialogProps
{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    confirmDisabled?: boolean;
    onConfirm: () => void;
}

/** Controlled confirmation dialog used for Setup and Deletes. */
export function ConfirmDialog({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel = "Continue",
    cancelLabel = "Cancel",
    destructive = false,
    confirmDisabled = false,
    onConfirm,
}: ConfirmDialogProps)
{
    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={confirmDisabled}>{cancelLabel}</AlertDialogCancel>
                    <AlertDialogAction
                        type="button"
                        variant={destructive ? "destructive" : "default"}
                        size="sm"
                        disabled={confirmDisabled}
                        onClick={() =>
                        {
                            onOpenChange(false);
                            onConfirm();
                        }}
                    >
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
