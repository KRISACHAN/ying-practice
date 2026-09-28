import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Agent Stack Lab',
    description:
        'Vercel AI SDK、LangChain、LangGraph 与 LangSmith 的交互式学习示例',
};

export default function RootLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <html lang="zh-CN">
            <body>{children}</body>
        </html>
    );
}
