/**
 * Ant Design workspace layout for module lists and editors.
 */

import { Splitter } from "antd";
import { HarnessesPanel, WorkspaceEditor } from "@/features/workspace/WorkspaceEditor";
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

    if (view === "project" || view === "skills")
    {
        return (
            <div className="workspace-scroll" key={view}>
                <div className="workspace-wide-page">{view === "project" ? <HarnessesPanel /> : <SkillsPanel />}</div>
            </div>
        );
    }

    return (
        <div className="workspace-module-page">
            <div className="workspace-module-surface">
                <Splitter key={view} className="workspace-splitter">
                    <Splitter.Panel defaultSize="28%" min="20%" max="45%" collapsible>
                        <WorkspaceTree view={view} />
                    </Splitter.Panel>
                    <Splitter.Panel min="55%">
                        <WorkspaceEditor key={selectionKey(selection)} />
                    </Splitter.Panel>
                </Splitter>
            </div>
        </div>
    );
}
