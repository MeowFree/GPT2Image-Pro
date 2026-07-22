import { defineCollections, defineDocs, frontmatterSchema } from "fumadocs-mdx/config";
import { z } from "zod";

/**
 * Fumadocs 内容源配置
 *
 * 定义文档和法律内容集合
 */

/**
 * 文档集合配置
 */
export const docs = defineDocs({
  dir: "src/content/docs",
});

/**
 * 法律文档 Frontmatter Schema
 */
const legalFrontmatter = frontmatterSchema.extend({
  title: z.string(),
  date: z.string().or(z.date()),
  description: z.string().optional(),
});

/**
 * 法律文档集合配置
 * 包含 Terms of Service, Privacy Policy, Cookie Policy
 */
export const legal = defineCollections({
  dir: "src/content/legal",
  schema: legalFrontmatter,
  type: "doc",
});
