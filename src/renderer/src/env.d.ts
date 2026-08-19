/**
 * Renderer ambient types. `Window.appApi` is the only privileged surface.
 */

/// <reference types="vite/client" />

import type { AppApi } from "@shared/contracts/AppApi";

declare global
{
    /** Browser window augmented with the preload `appApi` bridge. */
    interface Window
    {
        appApi: AppApi;
    }
}

declare module "*.css";

export {};
