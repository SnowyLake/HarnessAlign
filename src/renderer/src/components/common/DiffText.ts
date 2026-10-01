/** Read-only escaped lines with text markers and Ant Design token colors for source review. */

import { createElement } from "react";
import type { DiffLine } from "../../lib/TextDiff.js";

/** Render line additions and deletions without interpreting source text as markup. */
export function DiffText({ lines, label }: { lines: DiffLine[]; label: string })
{
    return createElement("pre", { "aria-label": label, style: { margin: 0, maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } },
        lines.map((line, index) => createElement("span", { key: index, "data-change": line.kind, style: { display: "block", minHeight: "1.3em",
            backgroundColor: line.kind === "added" ? "var(--ant-color-success-bg)" : line.kind === "removed" ? "var(--ant-color-error-bg)" : "transparent" } },
        `${line.kind === "added" ? "+ " : line.kind === "removed" ? "- " : "  "}${line.text}`)));
}
