/** Preserve explicit environment proxies and otherwise use Electron's system proxy support. */

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
