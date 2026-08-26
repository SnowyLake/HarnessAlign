/**
 * Development-only showcase for the active Ant Design theme.
 */

import { SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Form, Input, List, Select, Space, Switch, Tabs, Tag, Typography } from "antd";
import { useState } from "react";
import { showSuccess } from "@/components/common/Feedback";

/** Render a compact gallery of the official components used by the desktop app. */
export function ShowcasePage()
{
    const [isEnabled, setIsEnabled] = useState(true);

    return (
        <div className="workspace-scroll">
            <div className="showcase-page">
                <Card title="Buttons" extra="Action hierarchy">
                    <Space wrap>
                        <Button type="primary">Primary</Button>
                        <Button>Default</Button>
                        <Button type="text">Text</Button>
                        <Button type="link">Link</Button>
                        <Button danger>Destructive</Button>
                    </Space>
                </Card>
                <Card title="Inputs" extra="Official form controls">
                    <Form layout="vertical" requiredMark={false}>
                        <Form.Item label="Name"><Input defaultValue="Harness Align" /></Form.Item>
                        <Form.Item label="Search"><Input prefix={<SearchOutlined />} placeholder="Search skills..." /></Form.Item>
                        <Form.Item label="Layer option" extra="Choose the active option for this layer.">
                            <Select defaultValue="default" options={[{ label: "default", value: "default" }, { label: "unity", value: "unity" }]} />
                        </Form.Item>
                        <Form.Item label="Enabled"><Switch checked={isEnabled} onChange={setIsEnabled} /></Form.Item>
                    </Form>
                </Card>
                <Card title="Tabs and lists" extra="Navigation and structured rows">
                    <Tabs items={[
                        {
                            key: "installed",
                            label: "Installed",
                            children: <List dataSource={["example-skill"]} renderItem={(item) => <List.Item actions={[<Button key="search" type="text" icon={<SearchOutlined />} />]}><List.Item.Meta title={item} description="A consistent Ant Design list row." /></List.Item>} />,
                        },
                        { key: "discover", label: "Discover", children: <Empty description="No discovered skills" /> },
                    ]} />
                </Card>
                <Card title="Feedback" extra="Alerts and transient messages">
                    <Space direction="vertical" size="middle" className="full-width">
                        <Alert message="Neutral alert" description="Inline guidance uses Alert." showIcon />
                        <Alert type="error" message="Error alert" description="Mutation failures show the full error message." showIcon />
                        <Button onClick={() => showSuccess("Message sample")}>Show message</Button>
                    </Space>
                </Card>
                <Card title="Typography" extra={<Tag>Segoe UI Variable</Tag>}>
                    <Space direction="vertical" size={4}>
                        <Typography.Title level={3}>Page title</Typography.Title>
                        <Typography.Title level={5}>Section title</Typography.Title>
                        <Typography.Text>Body and control text</Typography.Text>
                        <Typography.Text type="secondary">Caption and supporting metadata</Typography.Text>
                        <Typography.Text code>Technical text and source output</Typography.Text>
                    </Space>
                </Card>
            </div>
        </div>
    );
}
