/** Bounded line comparison for read-only source review, retaining all preview text. */

/** One text line with a visible addition or deletion marker. */
export interface DiffLine
{
    text: string;
    kind: "same" | "added" | "removed";
}

/** Align common lines with a bounded LCS table, falling back to a marked changed section. */
export function diffLines(before: string | null, after: string | null): { local: DiffLine[]; remote: DiffLine[]; limited: boolean }
{
    const left = before === null ? [] : before.split("\n");
    const right = after === null ? [] : after.split("\n");
    let start = 0;
    while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
    let end = 0;
    while (end < left.length - start && end < right.length - start && left[left.length - 1 - end] === right[right.length - 1 - end]) end += 1;
    const local: DiffLine[] = left.slice(0, start).map((text) => ({ text, kind: "same" }));
    const remote: DiffLine[] = right.slice(0, start).map((text) => ({ text, kind: "same" }));
    const a = left.slice(start, left.length - end);
    const b = right.slice(start, right.length - end);
    const limited = a.length * b.length > 250_000;
    if (limited)
    {
        local.push(...a.map((text): DiffLine => ({ text, kind: "removed" })));
        remote.push(...b.map((text): DiffLine => ({ text, kind: "added" })));
    }
    else
    {
        const width = b.length + 1;
        const table = new Uint32Array((a.length + 1) * width);
        for (let i = a.length - 1; i >= 0; i -= 1)
        {
            for (let j = b.length - 1; j >= 0; j -= 1) table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
        }
        let i = 0;
        let j = 0;
        while (i < a.length || j < b.length)
        {
            if (i < a.length && j < b.length && a[i] === b[j])
            {
                local.push({ text: a[i++]!, kind: "same" });
                remote.push({ text: b[j++]!, kind: "same" });
            }
            else if (i < a.length && (j === b.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) local.push({ text: a[i++]!, kind: "removed" });
            else remote.push({ text: b[j++]!, kind: "added" });
        }
    }
    local.push(...left.slice(left.length - end).map((text): DiffLine => ({ text, kind: "same" })));
    remote.push(...right.slice(right.length - end).map((text): DiffLine => ({ text, kind: "same" })));
    return { local, remote, limited };
}
