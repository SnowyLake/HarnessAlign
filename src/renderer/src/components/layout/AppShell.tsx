import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/Utils";
import { useAppStore, type AppView } from "@/stores/AppStore";

const NAV_ITEMS: Array<{ view: AppView; label: string }> = [
    { view: "workspace", label: "Workspace" },
    { view: "settings", label: "Settings" },
    { view: "showcase", label: "UI" },
];

/** Props for the desktop chrome that wraps feature pages. */
export interface AppShellProps
{
    children: ReactNode;
}

/** Props for workspace generate / check / setup actions. */
export interface ToolbarProps
{
    onOpen: () => void;
    onGenerate: () => void;
    onCheck: () => void;
    onSetup: () => void;
}

/** Left navigation between workspace, settings, and the UI showcase. */
export function Sidebar()
{
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    return (
        <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-sidebar">
            <div className="px-3 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Harness Align
            </div>
            <Separator />
            <nav className="flex flex-col gap-0.5 p-2">
                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.view}
                        type="button"
                        onClick={() => setView(item.view)}
                        className={cn(
                            "rounded-md px-2 py-1.5 text-left text-[13px]",
                            view === item.view ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
                        )}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
        </aside>
    );
}

/** Desktop frame with a sidebar and a single content column. */
export function AppShell({ children }: AppShellProps)
{
    return (
        <div className="flex h-full min-h-0">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
    );
}

/** Workspace command bar for opening a config root and running generate / check / setup. */
export function Toolbar({ onOpen, onGenerate, onCheck, onSetup }: ToolbarProps)
{
    const workspace = useAppStore((state) => state.workspace);
    const profile = useAppStore((state) => state.profile);
    const setProfile = useAppStore((state) => state.setProfile);
    const isBusy = useAppStore((state) => state.isBusy);
    return (
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
            <Button size="sm" onClick={onOpen}>Open</Button>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                {workspace?.root ?? "No workspace"}
            </span>
            <NativeSelect
                disabled={!workspace || isBusy}
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
            >
                {(workspace?.config.profiles ?? []).map((item) => (
                    <option key={item} value={item}>{item}</option>
                ))}
            </NativeSelect>
            <Button size="sm" variant="secondary" disabled={!workspace || isBusy} onClick={onGenerate}>Generate</Button>
            <Button size="sm" variant="secondary" disabled={!workspace || isBusy} onClick={onCheck}>Check</Button>
            <Button size="sm" variant="secondary" disabled={!workspace || isBusy} onClick={onSetup}>Setup</Button>
        </header>
    );
}
