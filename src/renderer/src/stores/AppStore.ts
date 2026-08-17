/**
 * Renderer-only UI state. Workspace files stay in Main; this store never reads the filesystem.
 */

import { create } from "zustand";
import type { ThemeMode } from "@shared/models/AppSettings";
import type { Workspace } from "@shared/models/Workspace";

/** Top-level desktop shell view. */
export type AppView = "workspace" | "settings" | "showcase";

/** Currently selected workspace editor target. */
export type Selection =
    | { kind: "settings" }
    | { kind: "harness"; name: string }
    | { kind: "harness-new" }
    | { kind: "profile"; name: string }
    | { kind: "rule"; path: string }
    | { kind: "rule-new"; scope: "root" | "domain" | "shared"; profile?: string }
    | { kind: "agent"; path: string }
    | { kind: "agent-new" };

/** Zustand state and setters for the desktop shell. */
interface AppState
{
    view: AppView;
    workspace: Workspace | undefined;
    selection: Selection;
    profile: string;
    log: string;
    isBusy: boolean;
    theme: ThemeMode;
    setView: (view: AppView) => void;
    setWorkspace: (workspace: Workspace | undefined) => void;
    setSelection: (selection: Selection) => void;
    setProfile: (profile: string) => void;
    setLog: (log: string) => void;
    setIsBusy: (isBusy: boolean) => void;
    setTheme: (theme: ThemeMode) => void;
}

/** Renderer UI state for workspace, settings, and command progress. */
export const useAppStore = create<AppState>((set) => ({
    view: "workspace",
    workspace: undefined,
    selection: { kind: "settings" },
    profile: "",
    log: "Open a directory that contains .halign.",
    isBusy: false,
    theme: "system",
    setView: (view) => set({ view }),
    setWorkspace: (workspace) => set({ workspace }),
    setSelection: (selection) => set({ selection }),
    setProfile: (profile) => set({ profile }),
    setLog: (log) => set({ log }),
    setIsBusy: (isBusy) => set({ isBusy }),
    setTheme: (theme) => set({ theme }),
}));
