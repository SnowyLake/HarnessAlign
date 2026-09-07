/**
 * Top-positioned Ant Design command messages and the full output modal.
 */

import { App as AntApp, Button, Modal } from "antd";
import { useEffect, type ReactNode } from "react";
import { useAppStore } from "@/stores/AppStore";

const OUTPUT_MESSAGE_KEY = "command-output";

/** Render command feedback through the existing top message system and output modal. */
export function AppOutput()
{
    const { message } = AntApp.useApp();
    const output = useAppStore((state) => state.output);
    const outputTone = useAppStore((state) => state.outputTone);
    const outputTitle = useAppStore((state) => state.outputTitle);
    const outputNoticeId = useAppStore((state) => state.outputNoticeId);
    const isOutputNoticeVisible = useAppStore((state) => state.isOutputNoticeVisible);
    const isOutputDialogOpen = useAppStore((state) => state.isOutputDialogOpen);
    const dismissOutputNotice = useAppStore((state) => state.dismissOutputNotice);
    const setOutputDialogOpen = useAppStore((state) => state.setOutputDialogOpen);

    useEffect(() =>
    {
        if (!isOutputNoticeVisible)
        {
            message.destroy(OUTPUT_MESSAGE_KEY);
            return;
        }
        void message.open({
            key: OUTPUT_MESSAGE_KEY,
            type: outputTone,
            duration: outputTone === "error" ? 6 : 3,
            content: <Button type="text" size="small" aria-label={`${outputTitle}: view output`} onClick={() =>
                {
                    dismissOutputNotice();
                    setOutputDialogOpen(true);
                }}>{outputTitle}</Button>,
            onClose: dismissOutputNotice,
        });
    }, [dismissOutputNotice, isOutputNoticeVisible, message, outputNoticeId, outputTitle, outputTone, setOutputDialogOpen]);

    const footer: ReactNode = <Button onClick={() => setOutputDialogOpen(false)}>Close</Button>;
    return (
        <Modal open={isOutputDialogOpen} title={outputTitle} width={760} footer={footer} onCancel={() => setOutputDialogOpen(false)}>
            <pre className="app-output-pre">{output}</pre>
        </Modal>
    );
}
