import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";

/** DEV-only gallery of shared UI primitives including rebuilt shell components. */
export function ShowcasePage()
{
    const [isEnabled, setIsEnabled] = useState(true);

    return (
        <div className="grid max-w-3xl gap-4 overflow-auto p-6">
            <h1 className="text-lg font-semibold">Design system</h1>
            <Card className="grid gap-3">
                <h2 className="font-medium">Buttons</h2>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm">Primary</Button>
                    <Button size="sm" variant="secondary">Secondary</Button>
                    <Button size="sm" variant="outline">Outline</Button>
                    <Button size="sm" variant="ghost">Ghost</Button>
                    <Button size="sm" variant="destructive">Destructive</Button>
                </div>
            </Card>
            <Card className="grid gap-3">
                <h2 className="font-medium">Inputs</h2>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">Name<Input defaultValue="Harness Align" /></Label>
                <Label className="grid gap-1 text-[12px] text-muted-foreground">
                    Layer option
                    <Select defaultValue="default">
                        <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="default">default</SelectItem>
                            <SelectItem value="unity">unity</SelectItem>
                        </SelectContent>
                    </Select>
                </Label>
                <Label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    Enabled
                    <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
                </Label>
            </Card>
            <Card className="grid gap-3">
                <h2 className="font-medium">Feedback</h2>
                <Alert>
                    <AlertTitle>Neutral alert</AlertTitle>
                    <AlertDescription>Inline form warnings use Alert.</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                    <AlertTitle>Error alert</AlertTitle>
                    <AlertDescription>Mutation failures show the full error.message here.</AlertDescription>
                </Alert>
                <Button
                    size="sm"
                    variant="secondary"
                    type="button"
                    onClick={() => toast.add({ title: "Toast sample", type: "success" })}
                >
                    Show toast
                </Button>
            </Card>
            <Empty className="border border-dashed">
                <EmptyHeader>
                    <EmptyTitle>Empty state</EmptyTitle>
                    <EmptyDescription>Used when no workspace is open.</EmptyDescription>
                </EmptyHeader>
            </Empty>
            <Card>
                <h2 className="font-medium">Typography</h2>
                <p className="mt-2">Body text uses muted borders and moderate density.</p>
                <p className="text-muted-foreground">Muted text for secondary information.</p>
            </Card>
        </div>
    );
}
