/**
 * Ant Design feedback bridge for renderer code that runs outside React components.
 */

import { App as AntApp } from "antd";
import type { MessageInstance } from "antd/es/message/interface";
import { useEffect } from "react";

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

    return null;
}

/** Show a successful transient message through the mounted Ant Design app. */
export function showSuccess(content: string): void
{
    void messageApi?.success(content);
}

/** Show an error transient message through the mounted Ant Design app. */
export function showError(content: string): void
{
    void messageApi?.error(content);
}
