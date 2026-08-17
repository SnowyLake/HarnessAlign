import type { ThemeMode } from "@shared/models/AppSettings";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useAppStore } from "@/stores/AppStore";

/** Apply the current theme class on `document.documentElement`. */
export function applyTheme(theme: ThemeMode): void
{
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
}

/** Desktop page for theme and other app-level settings. */
export function SettingsPage()
{
    const theme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const setLog = useAppStore((state) => state.setLog);
    return (
        <div className="max-w-xl p-6">
            <h1 className="text-lg font-semibold">Application settings</h1>
            <p className="mt-1 text-muted-foreground">Theme is persisted by Main. Workspace files stay in the opened `.halign` directory.</p>
            <Card className="mt-4 grid gap-3">
                <Label>
                    Theme
                    <NativeSelect
                        className="w-full"
                        value={theme}
                        onChange={(event) =>
                        {
                            const next = event.target.value as ThemeMode;
                            void window.appApi.settings.update({ theme: next }).then((settings) =>
                            {
                                setTheme(settings.theme);
                                applyTheme(settings.theme);
                                setLog("Saved application theme.");
                            }).catch((error: unknown) => setLog(error instanceof Error ? error.message : String(error)));
                        }}
                    >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                    </NativeSelect>
                </Label>
            </Card>
        </div>
    );
}
