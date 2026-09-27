/**
 * Ant Design workspace layout for module lists and editors.
 */

import { Splitter } from "antd";
import { HarnessesPanel, WorkspaceEditor } from "@/features/workspace/WorkspaceEditor";
import { SkillsPanel } from "@/features/workspace/SkillsPanel";
import { WorkspaceTree } from "@/features/workspace/WorkspaceTree";
import type { WorkspaceView } from "@/stores/AppStore";

/** Props for the split workspace module page. */
export interface WorkspacePageProps
{
    view: WorkspaceView;
}

/** Render a full-width project module or the Ant Design split list and editor view. */
export function WorkspacePage({ view }: WorkspacePageProps)
{
    if (view === "project")
    {
        return (
            <div className="workspace-scroll" key={view}>
                <div className="workspace-wide-page"><HarnessesPanel /></div>
            </div>
        );
    }

    return (
        <div className="workspace-module-page">
            <div className="workspace-module-surface">
                {view === "skills" ? <SkillsPanel /> :
                <Splitter key={view === "shared-rules" ? "rules" : view} className="workspace-splitter">
                    <Splitter.Panel defaultSize="28%" min="20%" max="45%" collapsible>
                        <WorkspaceTree view={view} />
                    </Splitter.Panel>
                    <Splitter.Panel min="55%">
                        <WorkspaceEditor />
                    </Splitter.Panel>
                </Splitter>}
            </div>
        </div>
    );
}
