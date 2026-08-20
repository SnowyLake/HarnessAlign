import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
    BotIcon,
    FileOutputIcon,
    FolderCogIcon,
    Layers3Icon,
    LayoutDashboardIcon,
    PaletteIcon,
    ScrollTextIcon,
    Settings2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarInset,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
    useSidebar,
} from "@/components/ui/sidebar";
import { useAppStore, type AppView } from "@/stores/AppStore";

/** Navigation item shown in the app chrome sidebar. */
interface NavItem
{
    view: AppView;
    label: string;
    icon: typeof LayoutDashboardIcon;
}

/** Primary workspace modules shown above the bottom utility navigation. */
const WORKSPACE_NAV_ITEMS: NavItem[] = [
    { view: "project", label: "Project", icon: FolderCogIcon },
    { view: "rules", label: "Rules", icon: ScrollTextIcon },
    { view: "layers", label: "Layers", icon: Layers3Icon },
    { view: "agents", label: "Agents", icon: BotIcon },
    { view: "generated", label: "Generated", icon: FileOutputIcon },
];

/** Props for the desktop chrome that wraps feature pages and owns header commands. */
export interface AppShellProps
{
    children: ReactNode;
    onOpen: () => void;
    onGenerate: () => void;
    onCheck: () => void;
    onSetup: () => void;
}

/** App chrome: shadcn Sidebar inset, header actions, and page children. */
export function AppShell({ children, onOpen, onGenerate, onCheck, onSetup }: AppShellProps)
{
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const { toggleSidebar } = useSidebar();
    const [version, setVersion] = useState("");
    const [setupOpen, setSetupOpen] = useState(false);
    const effectiveView = view === "showcase" && !import.meta.env.DEV ? "project" : view;

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

    useEffect(() =>
    {
        if (view === "showcase" && !import.meta.env.DEV) setView("project");
    }, [view, setView]);

    return (
        <>
            <Sidebar collapsible="icon" variant="inset">
                <SidebarHeader className="px-2 py-2">
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton tooltip="Toggle sidebar" onClick={toggleSidebar}>
                                <LayoutDashboardIcon size={16} />
                                <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Harness Align</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarHeader>
                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                {WORKSPACE_NAV_ITEMS.map((item) => (
                                    <SidebarMenuItem key={item.view}>
                                        <SidebarMenuButton
                                            isActive={effectiveView === item.view}
                                            tooltip={item.label}
                                            onClick={() => setView(item.view)}
                                        >
                                            <item.icon size={16} />
                                            <span>{item.label}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter className="gap-1 px-2 py-2">
                    <div className="px-2 pb-1 text-[11px] text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
                        {version ? `v${version}` : "—"}
                    </div>
                    <SidebarMenu>
                        {import.meta.env.DEV ? (
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    isActive={effectiveView === "showcase"}
                                    tooltip="UI Kit"
                                    onClick={() => setView("showcase")}
                                >
                                    <PaletteIcon size={16} />
                                    <span>UI Kit</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        ) : null}
                        <SidebarMenuItem>
                            <SidebarMenuButton
                                isActive={effectiveView === "settings"}
                                tooltip="Settings"
                                onClick={() => setView("settings")}
                            >
                                <Settings2Icon size={16} />
                                <span>Settings</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
                <SidebarRail />
            </Sidebar>
            <SidebarInset className="min-h-0 overflow-hidden">
                <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Button className="shrink-0" size="sm" variant={workspace ? "outline" : "default"} disabled={isBusy} onClick={onOpen}>
                            Open
                        </Button>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground" title={workspace?.root ?? "No project"}>
                            {workspace?.root ?? "No project"}
                        </span>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                        <Button size="sm" variant="secondary" disabled={!workspace || isBusy} onClick={onCheck}>
                            Check
                        </Button>
                        <Button size="sm" variant="secondary" disabled={!workspace || isBusy} onClick={onGenerate}>
                            Generate
                        </Button>
                        <Button size="sm" variant={workspace ? "default" : "secondary"} disabled={!workspace || isBusy} onClick={() => setSetupOpen(true)}>
                            Setup
                        </Button>
                    </div>
                </header>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
            </SidebarInset>
            <ConfirmDialog
                open={setupOpen}
                onOpenChange={setSetupOpen}
                title="Run Setup?"
                description="Setup updates existing harness directories under USERPROFILE and shared-rules. Continue?"
                confirmLabel="Setup"
                confirmDisabled={isBusy}
                onConfirm={onSetup}
            />
        </>
    );
}
