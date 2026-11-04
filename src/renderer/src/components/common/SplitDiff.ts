/** One-scroll split diff. The left column is the current text and the right column is the replacement. */

import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { diffLines, type DiffSide, type DiffSpan, type LineDiff } from "../../lib/TextDiff.js";

/** One labeled version shown in a split diff. */
export interface DiffPane
{
    label: string;
    /** Short role such as Current or After sync. */
    role?: string;
    /** Extra state such as Absent or a truncated preview. */
    status?: string;
    /** File text. Null means this version has no file. Ignored when `binary` is set. */
    text: string | null;
    /** Non-text payload. The column shows this note instead of aligned lines. */
    binary?: string;
}

/** Read-only aligned comparison. Narrow containers stack each changed block as a unified diff. */
export function SplitDiff({ before, after, label, summary = "", layout }: { before: DiffPane; after: DiffPane; label: string; summary?: string; layout?: "split" | "unified" })
{
    const rootRef = useRef<HTMLDivElement>(null);
    const [narrow, setNarrow] = useState(false);
    const unified = layout === "unified" || (layout !== "split" && narrow);
    const binary = before.binary !== undefined || after.binary !== undefined;
    const diff = binary ? undefined : diffLines(before.text, after.text);
    const signature = `${before.text ?? ""}\0${after.text ?? ""}\0${before.binary ?? ""}\0${after.binary ?? ""}`;

    useEffect(() =>
    {
        const root = rootRef.current;
        if (!root) return undefined;
        const observer = new ResizeObserver((entries) =>
        {
            const width = entries[0]?.contentRect.width ?? 0;
            const next = width > 0 && width < 560;
            setNarrow((current) => current === next ? current : next);
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    useEffect(() =>
    {
        const root = rootRef.current;
        if (!root) return undefined;
        const frame = requestAnimationFrame(() =>
        {
            const scroller = scrollParent(root);
            const row = scroller?.querySelector(".split-diff-row.is-change");
            if (!scroller || !(row instanceof HTMLElement) || !root.contains(row)) return;
            const rowTop = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            if (rowTop < scroller.clientHeight * 0.75) return;
            scroller.scrollTop = Math.max(0, rowTop - scroller.clientHeight / 3);
        });
        return () => cancelAnimationFrame(frame);
    }, [signature]);

    return createElement("div", { ref: rootRef, className: unified ? "split-diff is-unified" : "split-diff", role: "region", "aria-label": label },
        header(before, after, summary, unified),
        binary || !diff ? binaryBody(before, after) : textBody(diff, unified),
        diff?.limited ? createElement("p", { className: "split-diff-footnote" }, "Large change. Unchanged lines inside this region are not matched individually.") : null);
}

/** Keep the column titles and the write direction visible while the review pane scrolls. */
function header(before: DiffPane, after: DiffPane, summary: string, unified: boolean): ReactNode
{
    const summaryNode = summary ? createElement("p", { className: "split-diff-summary" }, summary) : null;
    if (unified)
    {
        const status = [before.status, after.status].filter((item) => item).join(" · ");
        return createElement("div", { className: "split-diff-head" }, summaryNode,
            createElement("div", { className: "split-diff-head-side" },
                createElement("span", { className: "split-diff-title" }, `${before.label} → ${after.label}`),
                before.role && after.role ? createElement("span", { className: "split-diff-role" }, `${before.role} → ${after.role}`) : null,
                status ? createElement("span", { className: "split-diff-role" }, status) : null));
    }
    return createElement("div", { className: "split-diff-head" }, summaryNode, paneTitle(before), paneTitle(after));
}

/** Render one column title and its optional role or status. */
function paneTitle(pane: DiffPane): ReactNode
{
    return createElement("div", { className: "split-diff-head-side" },
        createElement("span", { className: "split-diff-title" }, pane.label),
        pane.role ? createElement("span", { className: "split-diff-role" }, pane.role) : null,
        pane.status ? createElement("span", { className: "split-diff-role" }, pane.status) : null);
}

/** Show hashes or other non-text notes without pretending they are line changes. */
function binaryBody(before: DiffPane, after: DiffPane): ReactNode
{
    return createElement("div", { className: "split-diff-row" }, plainCell(before), plainCell(after));
}

/** Render either aligned pairs or, in a narrow container, each changed block with deletions above additions. */
function textBody(diff: LineDiff, unified: boolean): ReactNode
{
    if (diff.rows.length === 0) return createElement("p", { className: "split-diff-footnote" }, "Both sides are absent.");
    if (!unified)
    {
        return diff.rows.map((row, index) =>
        {
            const changed = row.before?.kind === "removed" || row.after?.kind === "added";
            return createElement("div", { key: index, className: changed ? "split-diff-row is-change" : "split-diff-row" }, lineCell(row.before, `${index}-before`), lineCell(row.after, `${index}-after`));
        });
    }
    const blocks: ReactNode[] = [];
    let index = 0;
    while (index < diff.rows.length)
    {
        const row = diff.rows[index]!;
        if (row.before?.kind === "same")
        {
            blocks.push(createElement("div", { key: index, className: "split-diff-row" }, lineCell(row.before, `${index}-same`)));
            index += 1;
            continue;
        }
        let end = index;
        while (end < diff.rows.length && diff.rows[end]!.before?.kind !== "same") end += 1;
        const lines: ReactNode[] = [];
        for (let cursor = index; cursor < end; cursor += 1) if (diff.rows[cursor]!.before?.kind === "removed") lines.push(lineCell(diff.rows[cursor]!.before, `${cursor}-removed`));
        for (let cursor = index; cursor < end; cursor += 1) if (diff.rows[cursor]!.after?.kind === "added") lines.push(lineCell(diff.rows[cursor]!.after, `${cursor}-added`));
        blocks.push(createElement("div", { key: index, className: "split-diff-row is-change" }, lines));
        index = end;
    }
    return blocks;
}

/** Render one line, including its number, marker, and word highlights. */
function lineCell(side: DiffSide | null, key: string): ReactNode
{
    if (!side)
    {
        return createElement("div", { key, className: "split-diff-cell", "data-change": "empty" }, createElement("span", { className: "split-diff-text" }, "\u00a0"));
    }
    return createElement("div", { key, className: "split-diff-cell", "data-change": side.kind },
        createElement("span", { className: "split-diff-gutter", "aria-hidden": "true" }, String(side.line)),
        createElement("span", { className: "split-diff-marker", "aria-hidden": "true" }, side.kind === "added" ? "+" : side.kind === "removed" ? "-" : ""),
        createElement("span", { className: "split-diff-text" }, side.spans.map((span, index) => spanText(span, index))));
}

/** Render one unchanged or highlighted piece without interpreting the source as markup. */
function spanText(span: DiffSpan, index: number): ReactNode
{
    return span.changed ? createElement("span", { key: index, className: "split-diff-token" }, span.text) : createElement("span", { key: index }, span.text);
}

/** Render a binary note or the full text when the other side cannot be aligned. */
function plainCell(pane: DiffPane): ReactNode
{
    const text = pane.binary ?? (pane.text === null ? "Absent / deleted" : pane.text || "(empty file)");
    return createElement("div", { className: "split-diff-cell is-plain" }, createElement("pre", { className: "split-diff-plain" }, text));
}

/** Find the nearest ancestor that actually scrolls this diff. */
function scrollParent(element: HTMLElement): HTMLElement | null
{
    let parent = element.parentElement;
    while (parent)
    {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === "auto" || overflow === "scroll") return parent;
        parent = parent.parentElement;
    }
    return null;
}
