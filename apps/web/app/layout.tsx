import type { Metadata } from "next";

import { Providers } from "./providers";
import "./globals.css";

/** 全站元数据：默认标题模板 + 描述。 */
export const metadata: Metadata = {
  title: {
    default: "Prism — Field Desk",
    template: "%s — Prism",
  },
  description: "A local-first Field Desk for verifiable frontend repair requests.",
};

/** 根布局：包裹 Providers（react-query + toast）与全局样式。 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
