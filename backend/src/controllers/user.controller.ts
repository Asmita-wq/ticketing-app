import { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { getAgentStats, getAgentsOverview } from '../services/agentInsights.service';

export async function listUsers(req: Request, res: Response) {
  const result = await userService.listUsers(req.query as Record<string, never>);
  res.json({ success: true, ...result });
}

export async function listAgents(_req: Request, res: Response) {
  const agents = await userService.listAgents();
  res.json({ success: true, data: agents });
}

export async function listCustomers(req: Request, res: Response) {
  const customers = await userService.listCustomers(req.query.search as string | undefined);
  res.json({ success: true, data: customers });
}

export async function resetUserPassword(req: Request, res: Response) {
  const result = await userService.resetUserPassword(req.params.id, { id: req.user!.sub, role: req.user!.role });
  res.json({ success: true, data: result });
}

export async function agentsOverview(_req: Request, res: Response) {
  const data = await getAgentsOverview();
  res.json({ success: true, data });
}

export async function agentStats(req: Request, res: Response) {
  const data = await getAgentStats(req.params.id);
  res.json({ success: true, data });
}

export async function createAgent(req: Request, res: Response) {
  const agent = await userService.createAgent(req.body, { id: req.user!.sub, role: req.user!.role });
  res.status(201).json({ success: true, data: agent });
}

export async function updateAgent(req: Request, res: Response) {
  const agent = await userService.updateAgent(req.params.id, req.body, { id: req.user!.sub, role: req.user!.role });
  res.json({ success: true, data: agent });
}

export async function getUser(req: Request, res: Response) {
  const user = await userService.getUserById(req.params.id);
  res.json({ success: true, data: user });
}
