import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: '小满 · Companion Lab',
    description:
        'AI 女友对话场景：通过 React Flow 观察 LangChain、LangGraph、LangSmith 的分工与流转',
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
