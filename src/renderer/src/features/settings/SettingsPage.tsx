import type { ThemeMode } from "@shared/models/AppSettings";
import { useEffect, useState } from "react";
import { FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { useAppStore } from "@/stores/AppStore";

/** Apply the current theme class on `document.documentElement`. */
export function applyTheme(theme: ThemeMode): void
{
    const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
}

/** Theme choices rendered by the Base UI select. */
const THEME_ITEMS = [
    { label: "System", value: "system" },
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
] as const;

/** Desktop settings page for theme. */
export function SettingsPage()
{
    const theme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const workspaceRoot = useAppStore((state) => state.workspace?.root);
    const [version, setVersion] = useState("");
    const [isOpening, setIsOpening] = useState(false);
    const configDirectory = workspaceRoot ? `${workspaceRoot}\\.halign` : "%USERPROFILE%\\.halign";

    useEffect(() =>
    {
        void window.appApi.app.getVersion().then(setVersion).catch(() => setVersion(""));
    }, []);

    return (
        <div className="mx-auto w-full max-w-2xl overflow-auto p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Application</CardTitle>
                    <CardDescription>Appearance and local workspace information.</CardDescription>
                </CardHeader>
                <CardContent>
                    <FieldGroup>
                        <Field>
                            <FieldLabel htmlFor="theme-select">Theme</FieldLabel>
                            <Select
                                items={THEME_ITEMS}
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
                                <SelectTrigger id="theme-select" className="w-full"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value="system">System</SelectItem>
                                        <SelectItem value="light">Light</SelectItem>
                                        <SelectItem value="dark">Dark</SelectItem>
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                            <FieldDescription>Follow the operating system or choose a fixed theme.</FieldDescription>
                        </Field>
                        <Field>
                            <FieldTitle>Config directory</FieldTitle>
                            <div className="flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate" title={configDirectory}>{configDirectory}</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isOpening}
                                    onClick={() =>
                                    {
                                        setIsOpening(true);
                                        void window.appApi.app.openConfigDirectory().then(() => undefined).catch((error: unknown) =>
                                        {
                                            toast.add({ title: error instanceof Error ? error.message : String(error), type: "error" });
                                        }).finally(() => setIsOpening(false));
                                    }}
                                >
                                    <FolderOpenIcon data-icon="inline-start" />
                                    Open
                                </Button>
                            </div>
                            <FieldDescription>Harness Align reads configuration from this directory.</FieldDescription>
                        </Field>
                        <Field>
                            <FieldTitle>App version</FieldTitle>
                            <span>{version || "—"}</span>
                        </Field>
                    </FieldGroup>
                </CardContent>
            </Card>
        </div>
    );
}
