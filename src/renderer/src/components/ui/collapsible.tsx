import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

/** Expandable content root. */
function Collapsible(props: CollapsiblePrimitive.Root.Props)
{
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/** Button controlling a collapsible panel. */
function CollapsibleTrigger(props: CollapsiblePrimitive.Trigger.Props)
{
    return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

/** Panel that stays mounted so collapsed form controls remain part of submission. */
function CollapsibleContent({ keepMounted = true, ...props }: CollapsiblePrimitive.Panel.Props)
{
    return <CollapsiblePrimitive.Panel data-slot="collapsible-content" keepMounted={keepMounted} {...props} />;
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
