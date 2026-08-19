import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkspaceEditor } from "@/features/workspace/WorkspaceEditor";
import { WorkspaceTree } from "@/features/workspace/WorkspaceTree";
import { selectionKey, useAppStore, type WorkspaceView } from "@/stores/AppStore";

/** Props for the split workspace module page. */
export interface WorkspacePageProps
{
    view: WorkspaceView;
}

/** Workspace module page with a contextual tree and responsive editor. */
export function WorkspacePage({ view }: WorkspacePageProps)
{
    const selection = useAppStore((state) => state.selection);

    return (
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
            <ResizablePanel defaultSize="24" minSize="16" className="min-h-0 border-r border-border bg-card">
                <WorkspaceTree view={view} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="76" minSize="40" className="min-h-0">
                <ScrollArea className="h-full">
                    <div className="h-full min-w-0 p-4" key={selectionKey(selection)}>
                        <WorkspaceEditor />
                    </div>
                </ScrollArea>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}
