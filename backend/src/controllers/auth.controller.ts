import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import * as authService from '../services/auth.service';

export async function signup(req: Request, res: Response) {
  const user = await authService.registerUser(req.body);
  res.status(201).json({ success: true, data: user });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const result = await authService.loginUser(email, password, req.ip);
  res.json({ success: true, data: result });
}

export async function verifyOtp(req: Request, res: Response) {
  const { email, otp } = req.body;
  const result = await authService.verifyEmailOtp(email, otp);
  res.json({ success: true, data: result });
}

export async function resendOtp(req: Request, res: Response) {
  const { email } = req.body;
  await authService.resendSignupOtp(email);
  res.json({ success: true, message: 'If the account needs verification, a new code has been sent.' });
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body;
  const result = await authService.refreshAccessToken(refreshToken);
  res.json({ success: true, data: result });
}

export async function logout(req: Request, res: Response) {
  const { refreshToken } = req.body;
  await authService.logoutUser(refreshToken);
  res.json({ success: true, message: 'Logged out successfully' });
}

export async function forgotPassword(req: Request, res: Response) {
  const { email } = req.body;
  await authService.requestPasswordReset(email);
  res.json({ success: true, message: 'If an account exists for this email, a reset link has been sent.' });
}

export async function resetPassword(req: Request, res: Response) {
  const { email, otp, password } = req.body;
  await authService.resetPassword(email, otp, password);
  res.json({ success: true, message: 'Password has been reset successfully.' });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user!.sub, currentPassword, newPassword);
  res.json({ success: true, message: 'Password changed successfully.' });
}

export async function getProfile(req: Request, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user) throw ApiError.notFound('User not found');
  res.json({ success: true, data: authService.sanitizeUser(user) });
}

export async function updateProfile(req: Request, res: Response) {
  const user = await prisma.user.update({
    where: { id: req.user!.sub },
    data: req.body,
  });
  res.json({ success: true, data: authService.sanitizeUser(user) });
}
