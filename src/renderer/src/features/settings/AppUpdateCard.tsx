/**
 * Settings card for checking and installing a packaged GitHub Release.
 */

import { CloudDownloadOutlined } from "@ant-design/icons";
import type { AppUpdatePhase, AppUpdateStatus } from "@shared/models/AppUpdate";
import { Alert, Button, Card, Flex, Progress, Space, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { showError, writeLog } from "@/components/common/Feedback";

/** Explain the current update phase in the card body. */
function updateDescription(status: AppUpdateStatus | null): string
{
    if (status === null) return "Loading the installed version.";
    switch (status.phase)
    {
        case "idle":
            return "Check the latest stable GitHub release.";
        case "checking":
            return "Checking for updates.";
        case "unavailable":
            return status.message ?? "Application updates run from the installed Windows app.";
        case "current":
            return "This install is up to date.";
        case "available":
            return status.availableVersion === null ? "A newer version is available." : `Version ${status.availableVersion} is available.`;
        case "downloading":
            return "Downloading the installer.";
        case "downloaded":
            return "Closing to install the update.";
        case "error":
            return "The update did not finish.";
        default:
        {
            const unexpected: never = status.phase;
            return unexpected;
        }
    }
}

/** Render the installed version and the user-started update actions. */
export function AppUpdateCard()
{
    const [status, setStatus] = useState<AppUpdateStatus | null>(null);
    const [pending, setPending] = useState<"check" | "download" | null>(null);
    const isBusy = useRef(false);
    const phase: AppUpdatePhase = status?.phase ?? "idle";
    const isChecking = phase === "checking" || pending === "check";
    const isInstalling = phase === "downloading" || phase === "downloaded" || pending === "download";
    const showDownload = phase === "available" || isInstalling;

    useEffect(() =>
    {
        let isCancelled = false;
        let isReady = false;
        const queued: AppUpdateStatus[] = [];
        const unsubscribe = window.appApi.appUpdate.onChanged((next) =>
        {
            if (isReady) setStatus(next);
            else queued.push(next);
        });
        void window.appApi.appUpdate.status().then((next) =>
        {
            if (isCancelled) return;
            isReady = true;
            setStatus(queued.at(-1) ?? next);
        }).catch((error: unknown) =>
        {
            if (!isCancelled) showError(error, "Update status unavailable");
        });
        return () =>
        {
            isCancelled = true;
            unsubscribe();
        };
    }, []);

    /** Ignore a second click until the in-flight update request settles. */
    function runUpdateAction(action: "check" | "download", work: () => Promise<void>): void
    {
        if (isBusy.current) return;
        isBusy.current = true;
        setPending(action);
        void work().finally(() =>
        {
            isBusy.current = false;
            setPending(null);
        });
    }

    /** Compare this install with the latest stable GitHub release. */
    function handleCheck(): void
    {
        runUpdateAction("check", () => window.appApi.appUpdate.check().then((next) =>
        {
            setStatus(next);
            if (next.phase === "current") writeLog("success", "Application is up to date", `Version ${next.currentVersion}`);
            else if (next.phase === "available" && next.availableVersion !== null) writeLog("info", "Application update available", `Version ${next.availableVersion}`);
            else if (next.phase === "unavailable") writeLog("info", "Application update unavailable", next.message ?? "Installed app required");
        }).catch((error: unknown) => showError(error, "Update check failed")));
    }

    /** Download the offered installer and let Main start the silent install. */
    function handleDownload(): void
    {
        runUpdateAction("download", () => window.appApi.appUpdate.download().then((next) =>
        {
            setStatus(next);
            if (next.phase === "downloaded" && next.availableVersion !== null) writeLog("success", "Application update downloaded", `Version ${next.availableVersion}`);
        }).catch((error: unknown) => showError(error, "Application update failed")));
    }

    return (
        <Card title={<Space><CloudDownloadOutlined />Application</Space>}>
            <Space orientation="vertical" size={12} style={{ display: "flex" }}>
                <Flex align="center" justify="space-between" gap={24} wrap>
                    <Space orientation="vertical" size={4} style={{ minWidth: 0, flex: "1 1 280px" }}>
                        <Typography.Text strong>Harness Align {status?.currentVersion ?? ""}</Typography.Text>
                        <Typography.Text type="secondary">{updateDescription(status)}</Typography.Text>
                    </Space>
                    <Space wrap>
                        {showDownload ? <Button type="primary" loading={isInstalling} disabled={isChecking || isInstalling} onClick={handleDownload}>Download and install</Button> : null}
                        <Button loading={isChecking} disabled={status === null || isChecking || isInstalling} onClick={handleCheck}>Check for updates</Button>
                    </Space>
                </Flex>
                {phase === "downloading" ? <Progress aria-label="Update download progress" percent={status?.percent ?? 0} size="small" status="active" /> : null}
                {status?.message && (phase === "error" || phase === "available") ? (
                    <Alert type={phase === "error" ? "error" : "warning"} showIcon title={phase === "error" ? "Update failed" : "Download failed"} description={status.message} />
                ) : null}
            </Space>
        </Card>
    );
}
