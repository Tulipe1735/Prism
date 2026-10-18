import type { AssistantStore } from "./store.ts";
import type { AgentTool } from "./types.ts";
import { Buffer } from "node:buffer";
import { z } from "zod";

/** The repository supplies materials, never the student's course history. */
export function courseMaterials(
  store: AssistantStore,
  fetcher: typeof fetch = fetch,
): AgentTool {
  return {
    definition: {
      name: "course_materials",
      description:
        "检索 LecterChu/nwpu-cram 的真实文件目录，或读取其中一份 Markdown/文本。须先依据门户/用户确认区分已修和在修、考试日期；仓库目录不证明修课或掌握。PDF/Office 附件仅列链接，需手动导入后才可引用正文。",
      parameters: {
        type: "object",
        properties: { course: { type: "string" }, path: { type: "string" } },
        required: ["course"],
        additionalProperties: false,
      },
    },
    async execute(args, context) {
      const { course, path } = z
        .object({
          course: z.string().min(1).max(200),
          path: z.string().max(2000).optional(),
        })
        .strict()
        .parse(args);
      const request = async (url: string): Promise<Response> => {
        const response = await fetcher(url, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "Prism-personal-assistant",
          },
          signal: AbortSignal.any([context.signal, AbortSignal.timeout(20_000)]),
        });
        if (!response.ok) throw new Error(`课程资料源不可用 HTTP ${response.status}`);
        return response;
      };
      const repo = z
        .object({ default_branch: z.string() })
        .parse(
          await (
            await request("https://api.github.com/repos/LecterChu/nwpu-cram")
          ).json(),
        );
      const tree = z
        .object({
          sha: z.string(),
          truncated: z.boolean(),
          tree: z.array(
            z.object({
              path: z.string(),
              type: z.string(),
              sha: z.string(),
              size: z.number().optional(),
            }),
          ),
        })
        .parse(
          await (
            await request(
              `https://api.github.com/repos/LecterChu/nwpu-cram/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
            )
          ).json(),
        );
      const files = tree.tree.filter((file) => file.type === "blob");
      if (!path)
        return {
          repository: "LecterChu/nwpu-cram",
          version: tree.sha,
          complete: !tree.truncated,
          warning: "社区资料，年份以文件与正文为准；不代表当前教学大纲或用户学习证据。",
          files: files
            .filter((file) => file.path.toLowerCase().includes(course.toLowerCase()))
            .slice(0, 60)
            .map((file) => ({
              ...file,
              url: `https://github.com/LecterChu/nwpu-cram/blob/${tree.sha}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
              contentRead: false,
            })),
        };
      const file = files.find((item) => item.path === path);
      if (!file) throw new Error("指定资料不在已核对的仓库目录中");
      const url = `https://github.com/LecterChu/nwpu-cram/blob/${tree.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
      if (!/\.(?:md|txt)$/i.test(path))
        return {
          url,
          contentRead: false,
          reason: "这是附件链接；请下载后手动导入，不将目录当作已读取正文。",
        };
      if ((file.size ?? 0) > 500_000) throw new Error("文件较大，请手动导入所需章节");
      const response = await request(
        `https://raw.githubusercontent.com/LecterChu/nwpu-cram/${tree.sha}/${path.split("/").map(encodeURIComponent).join("/")}`,
      );
      const content = await response.text();
      if (Buffer.byteLength(content) > 500_000) throw new Error("文件超过读取上限");
      const document = {
        id: `course:${file.sha}`,
        source: "course" as const,
        title: `${course} · ${path}`,
        url,
        content,
        version: file.sha,
        updatedAt: new Date().toISOString(),
        metadata: {
          repository: "LecterChu/nwpu-cram",
          path,
          course,
          contentRead: true,
          warning: "材料年份与覆盖以正文为准，不能证明用户修课或掌握。",
        },
      };
      store.upsertDocument(document);
      return document;
    },
  };
}
