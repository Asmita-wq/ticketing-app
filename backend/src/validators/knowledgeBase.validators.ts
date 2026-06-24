import { z } from 'zod';

export const createArticleSchema = z.object({
  title: z.string().min(3).max(200),
  content: z.string().min(10),
  category: z.string().min(2).max(100),
  tags: z.array(z.string()).default([]),
  isPublished: z.boolean().default(true),
});

export const updateArticleSchema = createArticleSchema.partial();

export const listArticlesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  category: z.string().optional(),
  search: z.string().optional(),
});
