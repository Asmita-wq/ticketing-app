import { z } from 'zod';
import { CommentVisibility } from '@prisma/client';

export const createCommentSchema = z.object({
  message: z.string().min(1),
  visibility: z.nativeEnum(CommentVisibility).default('PUBLIC'),
});
