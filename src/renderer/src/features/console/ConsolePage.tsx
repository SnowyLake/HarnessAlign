/** Application session history with full diagnostic output and optional scroll following. */

import { ClearOutlined } from "@ant-design/icons";
import { Button, Empty, Flex, Switch, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { showError } from "@/components/common/Feedback";
import { useAppStore } from "@/stores/AppStore";

/** Render every session record in chronological order, including failures during ongoing work. */
export function ConsolePage()
{
    const logs = useAppStore((state) => state.logs);
    const [isFollowing, setIsFollowing] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() =>
    {
        if (isFollowing && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [logs, isFollowing]);

    return (
        <div className="console-page">
            <Flex align="center" justify="space-between" gap={16} wrap>
                <div>
                    <Typography.Title level={3} className="page-title">Console</Typography.Title>
                    <Typography.Text type="secondary">{logs.length} {logs.length === 1 ? "entry" : "entries"} · Cleared when the application closes</Typography.Text>
                </div>
                <Flex align="center" gap={16}>
                    <Flex align="center" gap={8}>
                        <Switch size="small" checked={isFollowing} onChange={setIsFollowing} aria-label="Auto-scroll" />
                        <Typography.Text>Auto-scroll</Typography.Text>
                    </Flex>
                    <Button icon={<ClearOutlined />} disabled={logs.length === 0}
                            onClick={() => void window.appApi.console.clear().catch((error: unknown) => showError(error, "Clear console failed"))}>Clear</Button>
                </Flex>
            </Flex>
            <div ref={scrollRef} className="console-history" role="log" aria-label="Console history" aria-live="off" tabIndex={0}>
                {logs.length === 0 ? <Empty description="No logs yet" /> : logs.map((entry) => (
                    <article className="console-entry" key={entry.id}>
                        <Flex align="center" gap={8} wrap>
                            <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
                            <Tag color={entry.level === "error" ? "error" : entry.level === "success" ? "success" : "processing"}>{entry.level.toUpperCase()}</Tag>
                            <Typography.Text strong>{entry.title}</Typography.Text>
                        </Flex>
                        {entry.details && entry.details !== entry.title ? <pre>{entry.details}</pre> : null}
                    </article>
                ))}
            </div>
        </div>
    );
}
