/** Placeholder shown when a workspace panel has nothing selected. */
export interface EmptyStateProps
{
    title: string;
    body: string;
}

/** Centered title and supporting text for an empty editor pane. */
export function EmptyState({ title, body }: EmptyStateProps)
{
    return (
        <div className="p-6">
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-muted-foreground">{body}</p>
        </div>
    );
}
