/**
 * CodeMirror 6 source editor for workspace Markdown and JSON fields.
 * Hidden inputs participate in FormData drafts; Tab indents instead of moving focus.
 * The CLI never imports this module.
 */

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/Utils";

/** Language packs the workspace editors actually need. */
export type SourceLanguage = "markdown" | "json" | "plain";

/** Props for a CodeMirror field that can participate in an uncontrolled form. */
export interface SourceEditorProps
{
    name?: string;
    defaultValue?: string;
    language?: SourceLanguage;
    readOnly?: boolean;
    className?: string;
    "aria-label"?: string;
}

/** Editor chrome that follows the app light and dark CSS variables. */
const sourceEditorTheme = EditorView.theme({
    "&": {
        height: "100%",
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
        fontSize: "12px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    },
    ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
        lineHeight: "1.5",
    },
    ".cm-content": {
        caretColor: "var(--foreground)",
        padding: "8px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--foreground)",
    },
    ".cm-gutters": {
        backgroundColor: "var(--background)",
        color: "var(--muted-foreground)",
        borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine": {
        backgroundColor: "color-mix(in srgb, var(--accent) 80%, transparent)",
    },
    ".cm-activeLineGutter": {
        backgroundColor: "color-mix(in srgb, var(--accent) 80%, transparent)",
        color: "var(--foreground)",
    },
    "&.cm-focused": {
        outline: "none",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "color-mix(in srgb, var(--ring) 35%, transparent) !important",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: "color-mix(in srgb, var(--ring) 35%, transparent) !important",
    },
    ".cm-searchMatch": {
        backgroundColor: "color-mix(in srgb, var(--ring) 40%, transparent)",
    },
    ".cm-panels": {
        backgroundColor: "var(--card)",
        color: "var(--card-foreground)",
        borderTop: "1px solid var(--border)",
    },
    ".cm-button": {
        backgroundImage: "none",
        backgroundColor: "var(--secondary)",
        color: "var(--secondary-foreground)",
        border: "1px solid var(--border)",
    },
    ".cm-textfield": {
        backgroundColor: "var(--background)",
        color: "var(--foreground)",
        border: "1px solid var(--input)",
    },
});

/** Syntax colors that stay on the same CSS variables as the rest of the shell. */
const sourceHighlightStyle = HighlightStyle.define([
    { tag: tags.heading, color: "var(--foreground)", fontWeight: "700" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.link, color: "var(--ring)" },
    { tag: tags.url, color: "var(--muted-foreground)" },
    { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
    { tag: tags.keyword, color: "var(--foreground)", fontWeight: "600" },
    { tag: tags.string, color: "var(--muted-foreground)" },
    { tag: tags.number, color: "var(--foreground)" },
    { tag: tags.bool, color: "var(--foreground)" },
    { tag: tags.null, color: "var(--muted-foreground)" },
    { tag: tags.propertyName, color: "var(--foreground)", fontWeight: "600" },
    { tag: tags.atom, color: "var(--foreground)" },
    { tag: tags.meta, color: "var(--muted-foreground)" },
    { tag: tags.monospace, color: "var(--foreground)" },
    { tag: tags.processingInstruction, color: "var(--muted-foreground)" },
    { tag: tags.punctuation, color: "var(--muted-foreground)" },
    { tag: tags.bracket, color: "var(--muted-foreground)" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
]);

/** Return the language pack for a source field, or none for plain text. */
function languageExtension(language: SourceLanguage): Extension
{
    if (language === "markdown") return markdown();
    if (language === "json") return json();
    return [];
}

/** CodeMirror field that writes a hidden input so existing form snapshots keep working. */
export function SourceEditor({
    name,
    defaultValue = "",
    language = "plain",
    readOnly = false,
    className,
    "aria-label": ariaLabel,
}: SourceEditorProps)
{
    const hostRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() =>
    {
        const host = hostRef.current;
        if (!host) return;
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: defaultValue,
                extensions: [
                    history(),
                    drawSelection(),
                    dropCursor(),
                    lineNumbers(),
                    highlightActiveLine(),
                    highlightActiveLineGutter(),
                    indentOnInput(),
                    bracketMatching(),
                    highlightSelectionMatches(),
                    search(),
                    EditorView.lineWrapping,
                    keymap.of([...searchKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
                    languageExtension(language),
                    syntaxHighlighting(sourceHighlightStyle),
                    sourceEditorTheme,
                    EditorState.readOnly.of(readOnly),
                    EditorView.editable.of(!readOnly),
                    EditorView.contentAttributes.of(ariaLabel ? { "aria-label": ariaLabel } : {}),
                    EditorView.updateListener.of((update) =>
                    {
                        if (!update.docChanged || !inputRef.current) return;
                        inputRef.current.value = update.state.doc.toString();
                        inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
                    }),
                ],
            }),
        });
        return () => view.destroy();
        // Mount once; WorkspacePage remounts the pane when the selection changes.
    }, []);

    return (
        <div
            className={cn(
                "flex min-h-40 w-full min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background font-mono text-[12px] has-[.cm-focused]:ring-1 has-[.cm-focused]:ring-ring",
                className,
            )}
        >
            {name !== undefined ? <input ref={inputRef} type="hidden" name={name} defaultValue={defaultValue} /> : null}
            <div ref={hostRef} className="min-h-0 flex-1 [&_.cm-editor]:h-full" />
        </div>
    );
}
