/**
 * Ant Design feedback bridge for renderer code that runs outside React components.
 */

import { App as AntApp } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect } from "react";
import { useAppStore } from "@/stores/AppStore";
import type { LogChange, LogInput } from "@shared/models/Console";

let messageApi: MessageInstance | undefined;

/** Mount the context-aware Ant Design message API for shared workspace tasks. */
export function FeedbackBridge()
{
    const { message } = AntApp.useApp();

    useEffect(() =>
    {
        messageApi = message;
        return () =>
        {
            if (messageApi === message) messageApi = undefined;
        };
    }, [message]);

    useEffect(() =>
    {
        let isCancelled = false;
        let isReady = false;
        const pending: LogChange[] = [];
        const unsubscribe = window.appApi.console.onChanged((change) =>
        {
            if (isReady) useAppStore.getState().applyLogChange(change);
            else pending.push(change);
        });
        void window.appApi.console.read().then((snapshot) =>
        {
            if (!isCancelled) useAppStore.getState().setLogSnapshot(snapshot);
        }).catch((error: unknown) =>
        {
            if (!isCancelled) showError(error, "Console history unavailable");
        }).finally(() =>
        {
            if (isCancelled) return;
            for (const change of pending) useAppStore.getState().applyLogChange(change);
            isReady = true;
        });

        /** Report otherwise unhandled renderer failures through the same console. */
        const handleError = (event: ErrorEvent): void => showError(event.error ?? event.message, "Application error");
        /** Retain rejected background work instead of losing it in developer tools. */
        const handleRejection = (event: PromiseRejectionEvent): void => showError(event.reason, "Background operation failed");
        window.addEventListener("error", handleError);
        window.addEventListener("unhandledrejection", handleRejection);
        return () =>
        {
            isCancelled = true;
            unsubscribe();
            window.removeEventListener("error", handleError);
            window.removeEventListener("unhandledrejection", handleRejection);
        };
    }, []);

    return null;
}

/** Send one record to Main's session history without logging request payloads. */
export function writeLog(level: LogInput["level"], title: string, details = title): void
{
    void window.appApi.console.append({ level, title, details }).catch(() =>
    {
        void messageApi?.error({ content: "Console unavailable", key: "operation-feedback", duration: 4 });
    });
}

/** Append full operation details and show only the short success title. */
export function showSuccess(title: string, details = title): void
{
    writeLog("success", title, details);
    void messageApi?.success({ content: title, key: "operation-feedback", duration: 2 });
}

/** Append the complete failure and keep diagnostic text out of transient messages. */
export function showError(error: unknown, title = "Operation failed"): void
{
    writeLog("error", title, error instanceof Error ? error.stack ?? error.message : String(error));
    void messageApi?.error({ content: title, key: "operation-feedback", duration: 4 });
}
