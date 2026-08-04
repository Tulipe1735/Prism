import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * 合并 Tailwind 类名：先用 clsx 处理条件类名，再用 tailwind-merge
 * 去重并解决类名冲突（后写的同类样式覆盖先写的）。
 *
 * @param inputs 可含条件/数组/嵌套的类名输入
 * @returns 合并后的类名字符串
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
