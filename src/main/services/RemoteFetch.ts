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
