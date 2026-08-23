import { CircleCheckIcon, InfoIcon, OctagonXIcon, XIcon } from "lucide-react";
import { useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { useAppStore, type OutputTone } from "@/stores/AppStore";

/** Status icon used by the compact output notification. */
function OutputIcon({ tone }: { tone: OutputTone })
{
    if (tone === "error") return <OctagonXIcon className="shrink-0 text-destructive" />;
    if (tone === "success") return <CircleCheckIcon className="shrink-0 text-foreground" />;
    return <InfoIcon className="shrink-0 text-muted-foreground" />;
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
                <Item
                    role="status"
                    variant="outline"
                    className="fixed right-4 bottom-4 z-40 w-[min(24rem,calc(100vw-2rem))] shadow-lg"
                >
                    <button
                        type="button"
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                        onClick={() =>
                        {
                            dismissOutputNotice();
                            setOutputDialogOpen(true);
                        }}
                    >
                        <ItemMedia><OutputIcon tone={outputTone} /></ItemMedia>
                        <ItemContent>
                            <ItemTitle>{outputTitle}</ItemTitle>
                            <ItemDescription className="truncate">{summary}</ItemDescription>
                        </ItemContent>
                    </button>
                    <ItemActions>
                        <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Dismiss output notification"
                            onClick={dismissOutputNotice}
                        >
                            <XIcon />
                        </Button>
                    </ItemActions>
                </Item>
            ) : null}
            <Dialog open={isOutputDialogOpen} onOpenChange={setOutputDialogOpen}>
                <DialogContent className="max-h-[80vh] w-[calc(100vw-2rem)] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto]">
                    <DialogHeader><DialogTitle>{outputTitle}</DialogTitle></DialogHeader>
                    <div className="min-h-0 overflow-auto"><pre className="font-mono text-code whitespace-pre-wrap text-foreground">{output}</pre></div>
                    <DialogFooter><Button variant="outline" onClick={() => setOutputDialogOpen(false)}>Close</Button></DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
