import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";

/** DEV-only gallery of shared UI primitives including rebuilt shell components. */
export function ShowcasePage()
{
    const [isEnabled, setIsEnabled] = useState(true);

    return (
        <div className="mx-auto grid w-full max-w-4xl gap-5 overflow-auto p-6">
            <Card>
                <CardHeader><CardTitle>Buttons</CardTitle><CardDescription>Action hierarchy and destructive states.</CardDescription></CardHeader>
                <CardContent>
                <div className="flex flex-wrap gap-2">
                    <Button>Primary</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="outline">Outline</Button>
                    <Button variant="ghost">Ghost</Button>
                    <Button variant="destructive">Destructive</Button>
                </div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>Inputs</CardTitle><CardDescription>Field composition with accessible labels and descriptions.</CardDescription></CardHeader>
                <CardContent><FieldGroup>
                <Field><FieldLabel htmlFor="showcase-name">Name</FieldLabel><Input id="showcase-name" defaultValue="Harness Align" /></Field>
                <Field>
                    <FieldLabel htmlFor="showcase-search">Search</FieldLabel>
                    <InputGroup>
                        <InputGroupInput id="showcase-search" placeholder="Search skills..." />
                        <InputGroupAddon align="inline-start"><SearchIcon /></InputGroupAddon>
                    </InputGroup>
                </Field>
                <Field>
                    <FieldLabel htmlFor="showcase-layer">Layer option</FieldLabel>
                    <Select items={[{ label: "default", value: "default" }, { label: "unity", value: "unity" }]} defaultValue="default">
                        <SelectTrigger id="showcase-layer" size="sm" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                <SelectItem value="default">default</SelectItem>
                                <SelectItem value="unity">unity</SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <FieldDescription>Choose the active option for this layer.</FieldDescription>
                </Field>
                <Field orientation="horizontal">
                    <Switch id="showcase-enabled" checked={isEnabled} onCheckedChange={setIsEnabled} />
                    <FieldLabel htmlFor="showcase-enabled">Enabled</FieldLabel>
                </Field>
                </FieldGroup></CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>Tabs and items</CardTitle><CardDescription>Navigation and content-list composition used on the Skills page.</CardDescription></CardHeader>
                <CardContent>
                    <Tabs defaultValue="installed">
                        <TabsList variant="line">
                            <TabsTrigger value="installed">Installed</TabsTrigger>
                            <TabsTrigger value="discover">Discover</TabsTrigger>
                        </TabsList>
                        <TabsContent value="installed">
                            <ItemGroup>
                                <Item>
                                    <ItemContent><ItemTitle>example-skill</ItemTitle><ItemDescription>A consistent item row with secondary content.</ItemDescription></ItemContent>
                                    <ItemActions><Button size="icon-sm" variant="ghost" aria-label="Search example"><SearchIcon /></Button></ItemActions>
                                </Item>
                                <ItemSeparator />
                            </ItemGroup>
                        </TabsContent>
                        <TabsContent value="discover"><Empty><EmptyHeader><EmptyTitle>No discovered skills</EmptyTitle><EmptyDescription>Run Discover to populate this view.</EmptyDescription></EmptyHeader></Empty></TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
            <Card>
                <CardHeader><CardTitle>Feedback</CardTitle><CardDescription>Alerts and transient notifications.</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-3">
                <Alert>
                    <AlertTitle>Neutral alert</AlertTitle>
                    <AlertDescription>Inline form warnings use Alert.</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                    <AlertTitle>Error alert</AlertTitle>
                    <AlertDescription>Mutation failures show the full error.message here.</AlertDescription>
                </Alert>
                <Button
                    variant="secondary"
                    type="button"
                    onClick={() => toast.add({ title: "Toast sample", type: "success" })}
                >
                    Show toast
                </Button>
                </CardContent>
            </Card>
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>Empty state</EmptyTitle>
                    <EmptyDescription>Used when no workspace is open.</EmptyDescription>
                </EmptyHeader>
            </Empty>
            <Card>
                <CardHeader><CardTitle>Typography</CardTitle><CardDescription>The five shared text categories used throughout the app.</CardDescription></CardHeader>
                <CardContent className="flex flex-col gap-2">
                    <p className="text-lg font-semibold">Page title</p>
                    <p className="text-base font-semibold">Section title</p>
                    <p className="text-sm">Body and control text</p>
                    <p className="text-xs text-muted-foreground">Caption and supporting metadata</p>
                    <p className="font-mono text-code">Technical text and source output</p>
                </CardContent>
            </Card>
        </div>
    );
}
