import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/Utils";

/** Controlled or uncontrolled tab root. */
function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props)
{
    return <TabsPrimitive.Root data-slot="tabs" data-orientation={orientation} orientation={orientation} className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)} {...props} />;
}

/** Tab trigger collection with pill or line variants. */
function TabsList({ className, variant = "default", ...props }: TabsPrimitive.List.Props & { variant?: "default" | "line" })
{
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            data-variant={variant}
            className={cn("group/tabs-list inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:h-auto data-[variant=line]:gap-1 data-[variant=line]:rounded-none data-[variant=line]:bg-transparent data-[variant=line]:p-0", className)}
            {...props}
        />
    );
}

/** One selectable tab. */
function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props)
{
    return (
        <TabsPrimitive.Tab
            data-slot="tabs-trigger"
            className={cn("relative inline-flex h-7 flex-none items-center justify-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all outline-none select-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-active:bg-background data-active:text-foreground data-active:shadow-sm group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:shadow-none group-data-[variant=line]/tabs-list:data-active:shadow-none group-data-[variant=line]/tabs-list:after:absolute group-data-[variant=line]/tabs-list:after:opacity-0 group-data-[variant=line]/tabs-list:data-active:after:opacity-100 group-data-[variant=line]/tabs-list:after:bg-foreground group-data-[variant=line]/tabs-list:after:transition-opacity group-data-[orientation=horizontal]/tabs:group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[orientation=horizontal]/tabs:group-data-[variant=line]/tabs-list:after:-bottom-1 group-data-[orientation=horizontal]/tabs:group-data-[variant=line]/tabs-list:after:h-0.5", className)}
            {...props}
        />
    );
}

/** Content associated with one tab value. */
function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props)
{
    return <TabsPrimitive.Panel data-slot="tabs-content" className={cn("flex-1 outline-none", className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
