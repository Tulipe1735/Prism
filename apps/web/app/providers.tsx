"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastContainer } from "react-toastify";

/**
 * 客户端 Providers：挂载 react-query 的 QueryClient 与全局 toast 容器。
 *
 * QueryClient 用 useState 惰性创建，保证每个挂载只建一次且客户端/服务端
 * 渲染期间不共享实例。查询默认不在窗口聚焦时重拉、staleTime 10s；
 * 变更默认不自动重试（Run 创建等副作用操作失败应显式提示）。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ToastContainer
        aria-label="Notifications"
        autoClose={4_000}
        closeOnClick
        newestOnTop
        position="bottom-right"
        theme="light"
      />
    </QueryClientProvider>
  );
}
