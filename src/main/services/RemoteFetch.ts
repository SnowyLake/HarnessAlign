/** Preserve explicit environment proxies and otherwise use Electron's system proxy support. */

import { HalignError } from "../../engine/Model.js";

/** Share the desktop network stack without requiring Electron in the Node test runner. */
export async function fetchRemote(url: string, init: RequestInit): Promise<Response>
{
    const hasEnvironmentProxy = Boolean(process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY);
    if (process.versions.electron && !hasEnvironmentProxy)
    {
        const { net } = await import("electron");
        return net.fetch(url, init);
    }
    return fetch(url, init);
}

/** Describe recognized GitHub rate limits using only validated retry headers. */
export function githubRateLimitHint(response: Response, now = Date.now()): string | undefined
{
    if (response.status !== 429 && !(response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after")))) return undefined;
    const retry = response.headers.get("retry-after") ?? "";
    const reset = response.headers.get("x-ratelimit-reset") ?? "";
    const delay = /^\d{1,7}$/u.test(retry) ? Number(retry) * 1000 : /^\d{1,12}$/u.test(reset) ? Number(reset) * 1000 - now : 60_000;
    const seconds = Math.ceil((delay > 0 ? delay : 60_000) / 1000);
    return `GitHub API rate limit reached; wait ${seconds}s before retrying (after ${new Date(now + seconds * 1000).toISOString()}); avoid repeated requests`;
}

/** Read a bounded response, cancelling oversized bodies and releasing the stream reader. */
export async function readResponseBytes(response: Response, limit: number, context: string): Promise<Buffer>
{
    if (Number(response.headers.get("content-length")) > limit)
    {
        await response.body?.cancel();
        throw new HalignError(`${context}: exceeds ${limit} bytes`);
    }
    if (!response.body) throw new HalignError(`${context}: empty response body`);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try
    {
        for (;;)
        {
            const { done, value } = await reader.read();
            if (done) return Buffer.concat(chunks, size);
            size += value.byteLength;
            if (size > limit)
            {
                await reader.cancel();
                throw new HalignError(`${context}: exceeds ${limit} bytes`);
            }
            chunks.push(value);
        }
    }
    finally
    {
        reader.releaseLock();
    }
}
