import type { ThemeMode } from "@shared/models/AppSettings";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useAppStore } from "@/stores/AppStore";

/** Apply the current theme class on `document.documentElement`. */
export function applyTheme(theme: ThemeMode): void
{
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
}

/** Desktop settings page for theme and remembered project path. */
export function SettingsPage()
{
    const theme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const workspace = useAppStore((state) => state.workspace);
    const [version, setVersion] = useState("");
    const [lastWorkspaceRoot, setLastWorkspaceRoot] = useState<string | undefined>();

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
        void window.appApi.settings.get().then((settings) => setLastWorkspaceRoot(settings.lastWorkspaceRoot)).catch(() => undefined);
    }, [workspace?.root]);

    return (
        <div className="max-w-xl overflow-auto p-6">
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="mt-1 text-muted-foreground">Theme is persisted by Main. Project files stay in the opened `.halign` directory.</p>
            <Card className="mt-4 grid gap-3">
                <Label className="grid gap-1 text-[12px] text-muted-foreground">
                    Theme
                    <Select
                        value={theme}
                        onValueChange={(value) =>
                        {
                            if (value === null) return;
                            const next = value as ThemeMode;
                            void window.appApi.settings.update({ theme: next }).then((settings) =>
                            {
                                setTheme(settings.theme);
                                applyTheme(settings.theme);
                                toast.add({ title: "Theme saved", type: "success" });
                            }).catch((error: unknown) =>
                            {
                                toast.add({ title: error instanceof Error ? error.message : String(error), type: "error" });
                            });
                        }}
                    >
                        <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="system">System</SelectItem>
                            <SelectItem value="light">Light</SelectItem>
                            <SelectItem value="dark">Dark</SelectItem>
                        </SelectContent>
                    </Select>
                </Label>
                <div className="grid gap-1 text-[12px] text-muted-foreground">
                    <span>App version</span>
                    <span className="text-foreground">{version || "—"}</span>
                </div>
                <div className="grid gap-1 text-[12px] text-muted-foreground">
                    <span>Last project</span>
                    <span className="truncate text-foreground">{lastWorkspaceRoot ?? workspace?.root ?? "None"}</span>
                </div>
            </Card>
        </div>
    );
}
