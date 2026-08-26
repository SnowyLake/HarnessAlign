/**
 * CodeMirror source field styled from Ant Design tokens and bridged into native FormData.
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
import { theme as antTheme } from "antd";
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";

/** Language packs the workspace editors actually need. */
export type SourceLanguage = "markdown" | "json" | "plain";

/** Props for a CodeMirror field that participates in an uncontrolled form. */
export interface SourceEditorProps
{
    name?: string;
    defaultValue?: string;
    language?: SourceLanguage;
    readOnly?: boolean;
    autoHeight?: boolean;
    resizeKey?: unknown;
    className?: string;
    "aria-label"?: string;
}

/** Inline CSS variables supplied to CodeMirror from the current Ant Design token set. */
type SourceEditorStyle = CSSProperties & Record<`--source-${string}`, string>;

/** CodeMirror chrome that reads the active Ant Design token variables. */
const sourceEditorTheme = EditorView.theme({
    "&": {
        height: "100%",
        backgroundColor: "var(--source-bg)",
        color: "var(--source-text)",
        fontSize: "var(--source-font-size)",
        fontFamily: "var(--source-font-family)",
    },
    ".cm-scroller": {
        overflow: "auto",
        fontFamily: "inherit",
        lineHeight: "1.55",
    },
    ".cm-content": {
        caretColor: "var(--source-text)",
        padding: "10px 0",
    },
    ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--source-text)",
    },
    ".cm-gutters": {
        backgroundColor: "var(--source-bg)",
        color: "var(--source-muted)",
        borderRight: "1px solid var(--source-border)",
    },
    ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "var(--source-active)",
    },
    "&.cm-focused": {
        outline: "none",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--source-selection) !important",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: "var(--source-selection) !important",
    },
    ".cm-searchMatch": {
        backgroundColor: "var(--source-selection)",
    },
    ".cm-panels": {
        backgroundColor: "var(--source-elevated)",
        color: "var(--source-text)",
        borderTop: "1px solid var(--source-border)",
    },
    ".cm-button": {
        backgroundImage: "none",
        backgroundColor: "var(--source-active)",
        color: "var(--source-text)",
        border: "1px solid var(--source-border)",
    },
    ".cm-textfield": {
        backgroundColor: "var(--source-bg)",
        color: "var(--source-text)",
        border: "1px solid var(--source-border)",
    },
});

/** Neutral syntax colors that stay aligned with the Ant Design text hierarchy. */
const sourceHighlightStyle = HighlightStyle.define([
    { tag: tags.heading, color: "var(--source-text)", fontWeight: "700" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.link, color: "var(--source-accent)" },
    { tag: tags.url, color: "var(--source-muted)" },
    { tag: tags.comment, color: "var(--source-muted)", fontStyle: "italic" },
    { tag: tags.keyword, color: "var(--source-text)", fontWeight: "600" },
    { tag: tags.string, color: "var(--source-muted)" },
    { tag: tags.number, color: "var(--source-text)" },
    { tag: tags.bool, color: "var(--source-text)" },
    { tag: tags.null, color: "var(--source-muted)" },
    { tag: tags.propertyName, color: "var(--source-text)", fontWeight: "600" },
    { tag: tags.atom, color: "var(--source-text)" },
    { tag: tags.meta, color: "var(--source-muted)" },
    { tag: tags.monospace, color: "var(--source-text)" },
    { tag: tags.processingInstruction, color: "var(--source-muted)" },
    { tag: tags.punctuation, color: "var(--source-muted)" },
    { tag: tags.bracket, color: "var(--source-muted)" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
]);

/** Return the language pack for a source field, or none for plain text. */
function languageExtension(language: SourceLanguage): Extension
{
    if (language === "markdown") return markdown();
    if (language === "json") return json();
    return [];
}

/** Render a CodeMirror field whose value is mirrored into a hidden native input. */
export function SourceEditor({
    name,
    defaultValue = "",
    language = "plain",
    readOnly = false,
    autoHeight = false,
    resizeKey,
    className,
    "aria-label": ariaLabel,
}: SourceEditorProps)
{
    const { token } = antTheme.useToken();
    const hostRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const style: SourceEditorStyle = {
        "--source-bg": token.colorBgContainer,
        "--source-text": token.colorText,
        "--source-muted": token.colorTextSecondary,
        "--source-border": token.colorBorder,
        "--source-active": token.colorFillTertiary,
        "--source-selection": token.colorFillSecondary,
        "--source-elevated": token.colorBgElevated,
        "--source-accent": token.colorPrimaryText,
        "--source-font-size": `${token.fontSizeSM}px`,
        "--source-font-family": '"Cascadia Mono", Consolas, monospace',
    };

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
                    autoHeight ? EditorView.theme({ "&": { height: "auto" }, ".cm-scroller": { overflow: "visible" } }) : [],
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
        viewRef.current = view;
        return () =>
        {
            viewRef.current = null;
            view.destroy();
        };
    }, []);

    useLayoutEffect(() =>
    {
        viewRef.current?.requestMeasure();
    }, [resizeKey]);

    return (
        <div className={["source-editor", autoHeight ? "source-editor-auto" : "", className ?? ""].filter(Boolean).join(" ")} style={style}>
            {name !== undefined ? <input ref={inputRef} type="hidden" name={name} defaultValue={defaultValue} /> : null}
            <div ref={hostRef} className={autoHeight ? undefined : "source-editor-host"} />
        </div>
    );
}
