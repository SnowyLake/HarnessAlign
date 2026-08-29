/**
 * Ant Design command notification and full output modal.
 */

import { CheckCircleFilled, CloseCircleFilled } from "@ant-design/icons";
import { App as AntApp, Button, Modal, theme as antTheme } from "antd";
import { useEffect, type ReactNode } from "react";
import { useAppStore, type OutputTone } from "@/stores/AppStore";

const OUTPUT_NOTIFICATION_KEY = "command-output";

/** Return the themed Ant Design icon for one output tone. */
function OutputIcon({ tone }: { tone: OutputTone })
{
    const { token } = antTheme.useToken();
    if (tone === "error") return <CloseCircleFilled style={{ color: token.colorError }} />;
    return <CheckCircleFilled style={{ color: token.colorSuccess }} />;
}

/** Render command feedback through Ant Design notification and Modal components. */
export function AppOutput()
{
    const { notification } = AntApp.useApp();
    const output = useAppStore((state) => state.output);
    const outputTone = useAppStore((state) => state.outputTone);
    const outputTitle = useAppStore((state) => state.outputTitle);
    const outputNoticeId = useAppStore((state) => state.outputNoticeId);
    const isOutputNoticeVisible = useAppStore((state) => state.isOutputNoticeVisible);
    const isOutputDialogOpen = useAppStore((state) => state.isOutputDialogOpen);
    const dismissOutputNotice = useAppStore((state) => state.dismissOutputNotice);
    const setOutputDialogOpen = useAppStore((state) => state.setOutputDialogOpen);
    const summary = output.split("\n", 1)[0] || "View command output";

    useEffect(() =>
    {
        if (!isOutputNoticeVisible)
        {
            notification.destroy(OUTPUT_NOTIFICATION_KEY);
            return;
        }
        notification.open({
            key: OUTPUT_NOTIFICATION_KEY,
            placement: "bottomRight",
            duration: 15,
            message: outputTitle,
            description: summary,
            icon: <OutputIcon tone={outputTone} />,
            onClick: () =>
            {
                dismissOutputNotice();
                setOutputDialogOpen(true);
            },
            onClose: dismissOutputNotice,
        });
    }, [dismissOutputNotice, isOutputNoticeVisible, notification, outputNoticeId, outputTitle, outputTone, setOutputDialogOpen, summary]);

    const footer: ReactNode = <Button onClick={() => setOutputDialogOpen(false)}>Close</Button>;
    return (
        <Modal open={isOutputDialogOpen} title={outputTitle} width={760} footer={footer} onCancel={() => setOutputDialogOpen(false)}>
            <pre className="app-output-pre">{output}</pre>
        </Modal>
    );
}
