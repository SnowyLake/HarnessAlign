/**
 * Render Markdown without HTML, navigation, or image requests inside the sandboxed Renderer.
 */

import { createElement, Fragment, type ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown source captured from the current editor document. */
interface MarkdownPreviewProps
{
    content: string;
}

/** Keep document URLs inert instead of resolving them against the application origin. */
const MARKDOWN_COMPONENTS: Components = {
    a: ({ children }) => createElement("span", { className: "markdown-preview-link" }, children),
    img: ({ alt }) => createElement("span", { className: "markdown-preview-image" }, alt ? `[Image: ${alt}]` : "[Image]"),
};

/** Render standard Markdown and GFM without granting document content browser capabilities. */
export function MarkdownPreview({ content }: MarkdownPreviewProps): ReactElement
{
    const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/u.exec(content);
    const remaining = opening ? content.slice(opening[0].length) : "";
    const closing = opening ? /^---[ \t]*(?:\r?\n|$)/mu.exec(remaining) : null;
    const body = closing ? remaining.slice(closing.index + closing[0].length) : content;
    return createElement(Fragment, null,
                         closing ? createElement("pre", null, createElement("code", { className: "language-yaml" }, remaining.slice(0, closing.index))) : null,
                         createElement(ReactMarkdown, { children: body, remarkPlugins: [remarkGfm], components: MARKDOWN_COMPONENTS, skipHtml: true }));
}
