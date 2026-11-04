/** Aligned before/after lines for one split diff. Callers choose which text is current and which text replaces it. */

/** One visible piece of a line. Changed pieces are the edited words. */
export interface DiffSpan
{
    text: string;
    changed: boolean;
}

/** One side of an aligned diff row. */
export interface DiffSide
{
    /** 1-based line number in that version. */
    line: number;
    text: string;
    kind: "same" | "added" | "removed";
    spans: readonly DiffSpan[];
}

/** A pair of lines that share one horizontal row. A null side is an empty spacer. */
export interface DiffRow
{
    before: DiffSide | null;
    after: DiffSide | null;
}

/** Line diff oriented from the current text toward the text that replaces it. */
export interface LineDiff
{
    rows: readonly DiffRow[];
    /** True when the changed region was too large for a precise line match. */
    limited: boolean;
}

type LineEdit =
    | { type: "same"; beforeIndex: number; afterIndex: number }
    | { type: "remove"; beforeIndex: number }
    | { type: "add"; afterIndex: number };

const LINE_CELL_LIMIT = 250_000;
const TOKEN_CELL_LIMIT = 40_000;

/** Align `before` with `after`, pairing replacements onto the same row. */
export function diffLines(before: string | null, after: string | null): LineDiff
{
    const left = before === null ? [] : before.split("\n");
    const right = after === null ? [] : after.split("\n");
    let start = 0;
    while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
    let end = 0;
    while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end += 1;
    const middleLeft = left.slice(start, left.length - end);
    const middleRight = right.slice(start, right.length - end);
    const limited = middleLeft.length * middleRight.length > LINE_CELL_LIMIT;
    const edits: LineEdit[] = [];
    for (let index = 0; index < start; index += 1) edits.push({ type: "same", beforeIndex: index, afterIndex: index });
    if (limited)
    {
        for (let index = 0; index < middleLeft.length; index += 1) edits.push({ type: "remove", beforeIndex: start + index });
        for (let index = 0; index < middleRight.length; index += 1) edits.push({ type: "add", afterIndex: start + index });
    }
    else appendLineEdits(middleLeft, middleRight, start, edits);
    for (let index = 0; index < end; index += 1)
    {
        edits.push({ type: "same", beforeIndex: left.length - end + index, afterIndex: right.length - end + index });
    }
    return { rows: rowsFromEdits(edits, left, right, limited), limited };
}

/** Record the line edit script for a region small enough to match exactly. */
function appendLineEdits(left: readonly string[], right: readonly string[], offset: number, edits: LineEdit[]): void
{
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i -= 1)
    {
        for (let j = right.length - 1; j >= 0; j -= 1)
        {
            table[i * width + j] = left[i] === right[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
        }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length)
    {
        if (i < left.length && j < right.length && left[i] === right[j]) edits.push({ type: "same", beforeIndex: offset + i++, afterIndex: offset + j++ });
        else if (i < left.length && (j === right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) edits.push({ type: "remove", beforeIndex: offset + i++ });
        else edits.push({ type: "add", afterIndex: offset + j++ });
    }
}

/** Turn a linear edit script into side-by-side rows, pairing a changed block in order. */
function rowsFromEdits(edits: readonly LineEdit[], left: readonly string[], right: readonly string[], limited: boolean): DiffRow[]
{
    const rows: DiffRow[] = [];
    let index = 0;
    while (index < edits.length)
    {
        const edit = edits[index]!;
        if (edit.type === "same")
        {
            const text = left[edit.beforeIndex]!;
            rows.push({ before: side(edit.beforeIndex, text, "same", [{ text, changed: false }]), after: side(edit.afterIndex, text, "same", [{ text, changed: false }]) });
            index += 1;
            continue;
        }
        let hunkEnd = index;
        while (hunkEnd < edits.length && edits[hunkEnd]!.type !== "same") hunkEnd += 1;
        const removes = edits.slice(index, hunkEnd).filter((item): item is Extract<LineEdit, { type: "remove" }> => item.type === "remove");
        const adds = edits.slice(index, hunkEnd).filter((item): item is Extract<LineEdit, { type: "add" }> => item.type === "add");
        const pairs = Math.min(removes.length, adds.length);
        for (let pair = 0; pair < pairs; pair += 1)
        {
            const beforeText = left[removes[pair]!.beforeIndex]!;
            const afterText = right[adds[pair]!.afterIndex]!;
            const words = !limited && linesAreSimilar(beforeText, afterText) ? wordSpans(beforeText, afterText) : { before: [{ text: beforeText, changed: true }], after: [{ text: afterText, changed: true }] };
            rows.push({ before: side(removes[pair]!.beforeIndex, beforeText, "removed", words.before), after: side(adds[pair]!.afterIndex, afterText, "added", words.after) });
        }
        for (let pair = pairs; pair < removes.length; pair += 1)
        {
            const text = left[removes[pair]!.beforeIndex]!;
            rows.push({ before: side(removes[pair]!.beforeIndex, text, "removed", [{ text, changed: false }]), after: null });
        }
        for (let pair = pairs; pair < adds.length; pair += 1)
        {
            const text = right[adds[pair]!.afterIndex]!;
            rows.push({ before: null, after: side(adds[pair]!.afterIndex, text, "added", [{ text, changed: false }]) });
        }
        index = hunkEnd;
    }
    return rows;
}

/** Build one side of a row. `index` is the 0-based line in that version. */
function side(index: number, text: string, kind: DiffSide["kind"], spans: readonly DiffSpan[]): DiffSide
{
    return { line: index + 1, text, kind, spans };
}

/** Pair lines that still share a visible prefix or suffix so their common words can be marked. */
function linesAreSimilar(before: string, after: string): boolean
{
    const max = Math.max(before.length, after.length);
    if (max === 0) return true;
    const limit = Math.min(before.length, after.length);
    let prefix = 0;
    while (prefix < limit && before[prefix] === after[prefix]) prefix += 1;
    let suffix = 0;
    while (suffix < limit - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
    return prefix + suffix >= 3 || (prefix + suffix) / max >= 0.5;
}

/** Split a line on whitespace, keeping the separators so the pieces reconstruct the line. */
function tokenize(text: string): string[]
{
    return text.match(/\s+|\S+/g) ?? [];
}

/** Mark the words that differ between two paired lines. */
function wordSpans(before: string, after: string): { before: DiffSpan[]; after: DiffSpan[] }
{
    const left = tokenize(before);
    const right = tokenize(after);
    if (left.length * right.length > TOKEN_CELL_LIMIT) return { before: [{ text: before, changed: true }], after: [{ text: after, changed: true }] };
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i -= 1)
    {
        for (let j = right.length - 1; j >= 0; j -= 1)
        {
            table[i * width + j] = left[i] === right[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
        }
    }
    const beforeSpans: DiffSpan[] = [];
    const afterSpans: DiffSpan[] = [];
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length)
    {
        if (i < left.length && j < right.length && left[i] === right[j])
        {
            pushSpan(beforeSpans, left[i]!, false);
            pushSpan(afterSpans, right[j]!, false);
            i += 1;
            j += 1;
        }
        else if (i < left.length && (j === right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) pushSpan(beforeSpans, left[i++]!, true);
        else pushSpan(afterSpans, right[j++]!, true);
    }
    return { before: beforeSpans, after: afterSpans };
}

/** Append text to the previous span when the highlight does not change. */
function pushSpan(spans: DiffSpan[], text: string, changed: boolean): void
{
    const last = spans[spans.length - 1];
    if (last && last.changed === changed) last.text += text;
    else spans.push({ text, changed });
}
