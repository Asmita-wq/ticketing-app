import { Request, Response } from 'express';
import path from 'path';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import * as ticketService from '../services/ticket.service';

export async function createTicket(req: Request, res: Response) {
  const ticket = await ticketService.createTicket(
    { id: req.user!.sub, role: req.user!.role },
    req.body,
  );
  res.status(201).json({ success: true, data: ticket });
}

export async function listTickets(req: Request, res: Response) {
  const result = await ticketService.listTickets(req.query as Record<string, never>, {
    id: req.user!.sub,
    role: req.user!.role,
  });
  res.json({ success: true, ...result });
}

export async function getTicket(req: Request, res: Response) {
  const ticket = await ticketService.getTicketById(req.params.id, {
    id: req.user!.sub,
    role: req.user!.role,
  });
  res.json({ success: true, data: ticket });
}

export async function updateTicket(req: Request, res: Response) {
  const ticket = await ticketService.updateTicket(req.params.id, req.body, {
    id: req.user!.sub,
    role: req.user!.role,
  });
  res.json({ success: true, data: ticket });
}

export async function assignTicket(req: Request, res: Response) {
  const { assignedToId, note } = req.body;
  const ticket = await ticketService.assignTicket(req.params.id, assignedToId, note, req.user!.sub);
  res.json({ success: true, data: ticket });
}

export async function changeStatus(req: Request, res: Response) {
  const { status, note } = req.body;
  const ticket = await ticketService.changeTicketStatus(
    req.params.id,
    status,
    note,
    req.user!.sub,
    req.user!.role,
  );
  res.json({ success: true, data: ticket });
}

export async function changePriority(req: Request, res: Response) {
  const { priority } = req.body;
  const ticket = await ticketService.changeTicketPriority(req.params.id, priority, req.user!.sub);
  res.json({ success: true, data: ticket });
}

export async function escalateTicket(req: Request, res: Response) {
  const { note } = req.body;
  const ticket = await ticketService.escalateTicket(req.params.id, note, req.user!.sub);
  res.json({ success: true, data: ticket });
}

export async function bulkAssignTickets(req: Request, res: Response) {
  const { ticketIds, assignedToId } = req.body;
  const result = await ticketService.bulkAssignTickets(ticketIds, assignedToId, req.user!.sub);
  res.json({ success: true, data: result });
}

export async function autoAssignTicket(req: Request, res: Response) {
  const ticket = await ticketService.autoAssignTicket(req.params.id, req.user!.sub);
  res.json({ success: true, data: ticket });
}

export async function userEscalateTicket(req: Request, res: Response) {
  const { note } = req.body;
  const ticket = await ticketService.userEscalateTicket(req.params.id, note, req.user!.sub);
  res.json({ success: true, data: ticket });
}

export async function mergeTickets(req: Request, res: Response) {
  const { sourceTicketIds } = req.body;
  const ticket = await ticketService.mergeTickets(req.params.id, sourceTicketIds, req.user!.sub);
  res.json({ success: true, data: ticket });
}

export async function uploadAttachment(req: Request, res: Response) {
  if (!req.file) throw ApiError.badRequest('No file uploaded');

  // Verify ticket exists and requester has access
  await ticketService.getTicketById(req.params.id, { id: req.user!.sub, role: req.user!.role });

  const attachment = await prisma.ticketAttachment.create({
    data: {
      ticketId: req.params.id,
      uploadedById: req.user!.sub,
      fileName: req.file.originalname,
      filePath: `/uploads/${path.basename(req.file.path)}`,
      fileType: req.file.mimetype,
      fileSize: req.file.size,
    },
  });

  res.status(201).json({ success: true, data: attachment });
}
