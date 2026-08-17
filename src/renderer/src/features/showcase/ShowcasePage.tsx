import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useState } from "react";

/** Isolated gallery of shared UI primitives. */
export function ShowcasePage()
{
    const [isEnabled, setIsEnabled] = useState(true);
    return (
        <div className="grid max-w-3xl gap-4 overflow-auto p-6">
            <h1 className="text-lg font-semibold">Design system</h1>
            <Card className="grid gap-3">
                <h2 className="font-medium">Buttons</h2>
                <div className="flex flex-wrap gap-2">
                    <Button>Primary</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button variant="destructive">Destructive</Button>
                </div>
            </Card>
            <Card className="grid gap-3">
                <h2 className="font-medium">Inputs</h2>
                <Label>Name<Input defaultValue="Harness Align" /></Label>
                <Label>
                    Enabled
                    <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
                </Label>
            </Card>
            <Card>
                <h2 className="font-medium">Typography</h2>
                <p className="mt-2">Body text uses muted borders and moderate density.</p>
                <p className="text-muted-foreground">Muted text for secondary information.</p>
            </Card>
        </div>
    );
}
