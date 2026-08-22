import { useEffect } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProjectEditor, WorkspaceEditor } from "@/features/workspace/WorkspaceEditor";
import { SkillsPanel } from "@/features/workspace/SkillsPanel";
import { WorkspaceTree } from "@/features/workspace/WorkspaceTree";
import { selectionKey, useAppStore, type Selection, type WorkspaceView } from "@/stores/AppStore";

/** Return whether the selected editor owns a saveable form. */
function canSaveSelection(selection: Selection): boolean
{
    return selection.kind === "config"
        || selection.kind === "harness"
        || selection.kind === "harness-new"
        || selection.kind === "layer-new"
        || selection.kind === "layer"
        || selection.kind === "layer-option"
        || selection.kind === "layer-option-new"
        || selection.kind === "rule"
        || selection.kind === "rule-new"
        || selection.kind === "agent"
        || selection.kind === "agent-new";
}

/** Props for the split workspace module page. */
export interface WorkspacePageProps
{
    view: WorkspaceView;
}

/** Workspace module page with a contextual tree and responsive editor. */
export function WorkspacePage({ view }: WorkspacePageProps)
{
    const selection = useAppStore((state) => state.selection);
    const workspaceRoot = useAppStore((state) => state.workspace?.root);
    const isBusy = useAppStore((state) => state.isBusy);
    const requestEditorAction = useAppStore((state) => state.requestEditorAction);

    useEffect(() =>
    {
        const handleKeyDown = (event: KeyboardEvent): void =>
        {
            if (view === "skills") return;
            if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s" || !workspaceRoot || isBusy || !canSaveSelection(selection)) return;
            event.preventDefault();
            requestEditorAction(selection, "save");
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isBusy, requestEditorAction, selection, view, workspaceRoot]);

    if (view === "project" || view === "skills")
    {
        return (
            <ScrollArea className="h-full">
                <div className="min-h-full min-w-0 p-4" key={`${workspaceRoot ?? ""}:${view}`}>
                    {view === "project" ? <ProjectEditor /> : <SkillsPanel />}
                </div>
            </ScrollArea>
        );
    }

    return (
        <ResizablePanelGroup orientation="horizontal" className="h-full min-h-0">
            <ResizablePanel defaultSize="24" minSize="16" className="min-h-0 border-r border-border bg-card">
                <WorkspaceTree view={view} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="76" minSize="40" className="min-h-0">
                <ScrollArea className="h-full">
                    <div className="h-full min-w-0 p-4" key={`${workspaceRoot ?? ""}:${selectionKey(selection)}`}>
                        <WorkspaceEditor />
                    </div>
                </ScrollArea>
            </ResizablePanel>
        </ResizablePanelGroup>
    );
}
