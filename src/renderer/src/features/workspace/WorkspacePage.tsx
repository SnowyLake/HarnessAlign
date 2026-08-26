/**
 * Ant Design workspace layout for module lists and editors.
 */

import { Splitter } from "antd";
import { ProjectEditor, WorkspaceEditor } from "@/features/workspace/WorkspaceEditor";
import { SkillsPanel } from "@/features/workspace/SkillsPanel";
import { WorkspaceTree } from "@/features/workspace/WorkspaceTree";
import { selectionKey, useAppStore, type WorkspaceView } from "@/stores/AppStore";

/** Props for the split workspace module page. */
export interface WorkspacePageProps
{
    view: WorkspaceView;
}

/** Render a full-width module or the Ant Design split list and editor view. */
export function WorkspacePage({ view }: WorkspacePageProps)
{
    const selection = useAppStore((state) => state.selection);
    const workspaceRoot = useAppStore((state) => state.workspace?.root);

    if (view === "project" || view === "skills")
    {
        return (
            <div className="workspace-scroll" key={`${workspaceRoot ?? ""}:${view}`}>
                <div className="workspace-wide-page">{view === "project" ? <ProjectEditor /> : <SkillsPanel />}</div>
            </div>
        );
    }

    return (
        <div className="workspace-module-page">
            <div className="workspace-module-surface">
                <Splitter className="workspace-splitter">
                    <Splitter.Panel defaultSize={280} min={240} max={420}>
                        <WorkspaceTree view={view} />
                    </Splitter.Panel>
                    <Splitter.Panel min={480}>
                        <div className="workspace-scroll" key={`${workspaceRoot ?? ""}:${selectionKey(selection)}`}>
                            <div className="workspace-editor-page"><WorkspaceEditor /></div>
                        </div>
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    );
}
