import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
    BotIcon,
    CircleCheckIcon,
    FileOutputIcon,
    FolderCogIcon,
    Layers3Icon,
    LayoutDashboardIcon,
    PaletteIcon,
    RocketIcon,
    ScrollTextIcon,
    Settings2Icon,
    SparklesIcon,
    WandSparklesIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
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
import { useAppStore, visibleView, type AppView } from "@/stores/AppStore";

/** Navigation item shown in the app chrome sidebar. */
interface NavItem
{
    view: AppView;
    label: string;
    description: string;
    icon: typeof LayoutDashboardIcon;
}

/** Primary workspace modules shown above the bottom utility navigation. */
const WORKSPACE_NAV_ITEMS: NavItem[] = [
    { view: "project", label: "Project", description: "Configure harnesses, layers, and skill sources.", icon: FolderCogIcon },
    { view: "rules", label: "Rules", description: "Edit repository and shared instructions.", icon: ScrollTextIcon },
    { view: "layers", label: "Layers", description: "Manage selectable instruction layers.", icon: Layers3Icon },
    { view: "agents", label: "Agents", description: "Define reusable subagent profiles.", icon: BotIcon },
    { view: "skills", label: "Skills", description: "Discover and manage project skills.", icon: SparklesIcon },
    { view: "generated", label: "Generated", description: "Inspect generated harness output.", icon: FileOutputIcon },
];

/** Props for the desktop chrome that wraps feature pages and owns header commands. */
export interface AppShellProps
{
    children: ReactNode;
    onGenerate: () => void;
    onCheck: () => void;
    onSetup: () => void;
}

/** App chrome: shadcn Sidebar inset, header actions, and page children. */
export function AppShell({ children, onGenerate, onCheck, onSetup }: AppShellProps)
{
    const view = useAppStore((state) => state.view);
    const setView = useAppStore((state) => state.setView);
    const workspace = useAppStore((state) => state.workspace);
    const isBusy = useAppStore((state) => state.isBusy);
    const { toggleSidebar } = useSidebar();
    const [version, setVersion] = useState("");
    const [setupOpen, setSetupOpen] = useState(false);
    const effectiveView = visibleView(view);
    const currentNav = WORKSPACE_NAV_ITEMS.find((item) => item.view === effectiveView);
    const pageTitle = currentNav?.label ?? (effectiveView === "settings" ? "Settings" : "Design system");
    const pageDescription = currentNav?.description ?? (effectiveView === "settings" ? "Desktop preferences and local paths." : "Shared component showcase.");

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

    useEffect(() =>
    {
        if (visibleView(view) !== view) setView(visibleView(view));
    }, [view, setView]);

    return (
        <>
            <Sidebar collapsible="icon" variant="inset">
                <SidebarHeader className="px-2 py-2">
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton tooltip="Toggle sidebar" onClick={toggleSidebar}>
                                <LayoutDashboardIcon />
                                <span className="text-sm font-semibold">Harness Align</span>
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
                                            <item.icon />
                                            <span>{item.label}</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                ))}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
                <SidebarFooter className="gap-1 px-2 py-2">
                    <div className="px-2 pb-1 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">
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
                                    <PaletteIcon />
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
                                <Settings2Icon />
                                <span>Settings</span>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarFooter>
                <SidebarRail />
            </Sidebar>
            <SidebarInset className="min-h-0 overflow-hidden">
                <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
                    <div className="min-w-0">
                        <div className="truncate text-lg font-semibold">{pageTitle}</div>
                        <div className="truncate text-sm text-muted-foreground">{pageDescription}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {isBusy ? (
                            <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground" role="status">
                                <Spinner />
                                Working...
                            </span>
                        ) : null}
                        <Button variant="outline" disabled={!workspace || isBusy} onClick={onCheck}>
                            <CircleCheckIcon data-icon="inline-start" />
                            Check
                        </Button>
                        <Button variant="outline" disabled={!workspace || isBusy} onClick={onGenerate}>
                            <WandSparklesIcon data-icon="inline-start" />
                            Generate
                        </Button>
                        <Button disabled={!workspace || isBusy} onClick={() => setSetupOpen(true)}>
                            <RocketIcon data-icon="inline-start" />
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
                description="Setup updates existing harness directories under USERPROFILE, shared-rules, and same-name skills. Other user skills are kept. Continue?"
                confirmLabel="Setup"
                confirmDisabled={isBusy}
                onConfirm={onSetup}
            />
        </>
    );
}
