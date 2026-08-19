/**
 * Shared workspace runners used by the shell and editor forms.
 * Command errors go to Output; mutation errors return for form Alerts.
 */

import { toast } from "@/components/ui/toast";
import { useAppStore, type Selection } from "@/stores/AppStore";

/** Reload the open workspace after a source or generate change. */
export async function refreshWorkspace(next?: Selection): Promise<void>
{
    const current = useAppStore.getState().workspace;
    if (!current) return;
    const workspace = await window.appApi.workspace.load(current.root);
    const profile = useAppStore.getState().profile;
    useAppStore.getState().setWorkspace(workspace);
    useAppStore.getState().setProfile(workspace.config.profiles.includes(profile) ? profile : workspace.config.defaultProfile);
    if (next) useAppStore.getState().setSelection(next);
}

/** Run Open / Generate / Check / Setup work while holding busy; errors open the output notification flow. */
export async function runCommand(work: () => Promise<void>): Promise<void>
{
    const { beginBusy, endBusy, setOutput } = useAppStore.getState();
    beginBusy();
    try
    {
        await work();
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        setOutput(message, "error", "Command failed");
    }
    finally
    {
        endBusy();
    }
}

/** Run a form save/delete while holding busy; failures toast briefly and return the full message. */
export async function runMutation(work: () => Promise<void>): Promise<{ ok: true } | { ok: false; message: string }>
{
    const { beginBusy, endBusy } = useAppStore.getState();
    beginBusy();
    try
    {
        await work();
        return { ok: true };
    }
    catch (error)
    {
        const message = error instanceof Error ? error.message : String(error);
        toast.add({ title: "Action failed", type: "error" });
        return { ok: false, message };
    }
    finally
    {
        endBusy();
    }
}
