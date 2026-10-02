/** Persistent workflow overview shared by every page, with bounded diagnostic details. */
import { Badge, Popover, Tag } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useAppStore, workspaceChangeCount } from "@/stores/AppStore";
import { workflowStages } from "@/lib/WorkflowStatus";

/** Display saved-state evidence without hiding unsaved edits behind successful comparisons. */
export function WorkflowStatus()
{
    const workspace = useAppStore((state) => state.workspace);
    const dirtyCount = useAppStore(workspaceChangeCount);
    const sync = useAppStore((state) => state.syncStatus);
    const preview = useAppStore((state) => state.syncPreview);
    const [open, setOpen] = useState(false);
    if (!workspace) return null;
    const stages = workflowStages(workspace, dirtyCount, sync, preview);
    const changes = {
        Edits: [],
        Generated: workspace.generationStatus.changes,
        Setup: workspace.deploymentStatus.changes.filter((change) => change.status !== "unchanged" && !(change.status === "skipped" && change.path === "~/.agents/skills")),
        Sync: [],
    };
    return (
        <Popover trigger="click" placement="bottomLeft" open={open} onOpenChange={setOpen}
                 content={<div className="workflow-details">
                     <div className="workflow-heading">Workspace status</div>
                     {stages.map((stage) => <section className="workflow-detail-stage" key={stage.name}>
                         <div className="workflow-detail-heading"><span>{stage.name}</span><Badge status={stage.status} text={stage.label} /></div>
                         {stage.detail && stage.status !== "success" && !(stage.label === "Save first") ? <div className="workflow-detail-hint">{stage.detail}</div> : null}
                         {changes[stage.name].length > 0 ? <details className="workflow-changes">
                             <summary>{changes[stage.name].length} {stage.name === "Generated" ? "output" : "target"} {changes[stage.name].length === 1 ? "change" : "changes"}</summary>
                             <div className="workflow-change-list">{changes[stage.name].map((change) => <div className="workflow-change" key={change.path}>
                                 <span className="workflow-change-path">{change.path}</span><Tag>{change.status}</Tag>
                             </div>)}</div>
                         </details> : null}
                     </section>)}
                     {sync?.connected ? <div className="workflow-footnote">Remote checked when opening Sync</div> : null}
                 </div>}>
            <button type="button" className="workflow-status" aria-label="Workspace status details" aria-expanded={open}>
                <span className="workflow-stages" role="status">
                    {stages.map((stage) => <Tag className="workflow-stage" key={stage.name} aria-label={`${stage.name}: ${stage.label}`}
                                              color={stage.status === "success" ? "default" : stage.status === "warning" ? "orange" : stage.status}>
                        {stage.status === "success" ? <CheckCircleOutlined className="workflow-complete" /> : <Badge status={stage.status} />}
                        <span>{stage.name}</span>
                        {stage.status !== "success" ? <span className="workflow-stage-value">{stage.label === "Generate needed" || stage.label === "Deploy needed" || stage.label === "Sync needed" ? "Pending" : stage.label}</span> : null}
                    </Tag>)}
                </span>
            </button>
        </Popover>
    );
}
