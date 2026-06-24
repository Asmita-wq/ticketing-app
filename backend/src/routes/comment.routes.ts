import { Router } from 'express';
import * as commentController from '../controllers/comment.controller';
import { authenticate } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { createCommentSchema } from '../validators/comment.validators';

export const commentRoutes = Router();

commentRoutes.use(authenticate);

commentRoutes.get('/ticket/:ticketId', commentController.listComments);
commentRoutes.post('/ticket/:ticketId', validate({ body: createCommentSchema }), commentController.addComment);
