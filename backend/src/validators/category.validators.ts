import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(500).optional(),
});

export const createSubcategorySchema = z.object({
  name: z.string().min(2).max(100),
  categoryId: z.string().uuid(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  description: z.string().max(500).optional(),
});

export const updateSubcategorySchema = z.object({
  name: z.string().min(2).max(100),
});
