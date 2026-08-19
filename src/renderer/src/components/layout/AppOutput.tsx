import { CircleCheckIcon, InfoIcon, OctagonXIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/Utils";
import { useAppStore, type OutputTone } from "@/stores/AppStore";

/** Status icon used by the compact output notification. */
function OutputIcon({ tone }: { tone: OutputTone })
{
    if (tone === "error") return <OctagonXIcon className="size-4 shrink-0 text-destructive" />;
    if (tone === "success") return <CircleCheckIcon className="size-4 shrink-0 text-foreground" />;
    return <InfoIcon className="size-4 shrink-0 text-muted-foreground" />;
}

/** Bottom-right output notification that opens the full log in a centered dialog. */
export function AppOutput()
{
    const output = useAppStore((state) => state.output);
    const outputTone = useAppStore((state) => state.outputTone);
    const outputTitle = useAppStore((state) => state.outputTitle);
    const outputNoticeId = useAppStore((state) => state.outputNoticeId);
    const isOutputNoticeVisible = useAppStore((state) => state.isOutputNoticeVisible);
    const isOutputDialogOpen = useAppStore((state) => state.isOutputDialogOpen);
    const dismissOutputNotice = useAppStore((state) => state.dismissOutputNotice);
    const setOutputDialogOpen = useAppStore((state) => state.setOutputDialogOpen);
    const summary = output.split("\n", 1)[0] || "View command output";

    useEffect(() =>
    {
        if (!isOutputNoticeVisible) return undefined;
        const timeout = window.setTimeout(dismissOutputNotice, 15_000);
        return () => window.clearTimeout(timeout);
    }, [dismissOutputNotice, isOutputNoticeVisible, outputNoticeId]);

    return (
        <>
            {isOutputNoticeVisible ? (
                <div
                    role="status"
                    className={cn(
                        "fixed right-4 bottom-4 z-40 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-popover text-popover-foreground shadow-lg",
                        outputTone === "error" && "border-destructive/50",
                    )}
                >
                    <button
                        type="button"
                        className="flex w-full items-start gap-3 p-4 pr-11 text-left"
                        onClick={() =>
                        {
                            dismissOutputNotice();
                            setOutputDialogOpen(true);
                        }}
                    >
                        <OutputIcon tone={outputTone} />
                        <span className="min-w-0 flex-1">
                            <span className="block font-medium">{outputTitle}</span>
                            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{summary}</span>
                            <span className="mt-1 block text-[11px] text-muted-foreground">Click to view details</span>
                        </span>
                    </button>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Dismiss output notification"
                        className="absolute top-2 right-2"
                        onClick={dismissOutputNotice}
                    >
                        <XIcon />
                    </Button>
                </div>
            ) : null}
            <AlertDialog open={isOutputDialogOpen} onOpenChange={setOutputDialogOpen}>
                <AlertDialogContent className="max-h-[80vh] w-[calc(100vw-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] data-[size=default]:max-w-3xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{outputTitle}</AlertDialogTitle>
                    </AlertDialogHeader>
                    <AlertDialogDescription className="min-h-0 overflow-auto text-left">
                        <pre className="font-mono text-[12px] whitespace-pre-wrap text-foreground">{output}</pre>
                    </AlertDialogDescription>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Close</AlertDialogCancel>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
