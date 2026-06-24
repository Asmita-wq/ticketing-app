import { Request, Response } from 'express';
import * as commentService from '../services/comment.service';

export async function listComments(req: Request, res: Response) {
  const comments = await commentService.listComments(req.params.ticketId, {
    id: req.user!.sub,
    role: req.user!.role,
  });
  res.json({ success: true, data: comments });
}

export async function addComment(req: Request, res: Response) {
  const { message, visibility } = req.body;
  const comment = await commentService.addComment(req.params.ticketId, message, visibility, {
    id: req.user!.sub,
    role: req.user!.role,
  });
  res.status(201).json({ success: true, data: comment });
}
