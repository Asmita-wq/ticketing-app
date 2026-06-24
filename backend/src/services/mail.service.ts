import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.port === 465,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
});

interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  fromName?: string;
}

export async function sendMail(to: string, subject: string, html: string, opts?: { replyTo?: string; fromName?: string }): Promise<void> {
  if (!env.smtp.host) {
    logger.debug(`[mail:skip] SMTP not configured. Would send "${subject}" to ${to}`);
    return;
  }

  let from = env.smtp.from;
  if (opts?.fromName) {
    const address = env.smtp.from.match(/<(.+)>/)?.[1] ?? env.smtp.from;
    from = `${opts.fromName} <${address}>`;
  }

  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      html,
      ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
    });
  } catch (err) {
    logger.error(`Failed to send email to ${to}: ${(err as Error).message}`);
  }
}

// Generic ticket-activity email with a call-to-action button linking back to the ticket.
function ticketActivityTemplate(ticketNumber: string, heading: string, body: string, actionUrl: string) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
      <h2>${heading}</h2>
      <p style="color:#374151;">${body}</p>
      <p style="margin:24px 0;">
        <a href="${actionUrl}" style="background:#4f46e5;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;display:inline-block;">
          View &amp; Reply to Ticket
        </a>
      </p>
      <p style="font-size:12px;color:#6b7280;">Ticket reference: ${ticketNumber}. If the button doesn't work, open: <a href="${actionUrl}">${actionUrl}</a></p>
    </div>
  `;
}

const roleLabels: Record<string, string> = {
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SUPPORT_AGENT: 'Support Agent',
  USER: 'User',
};

export const emailTemplates = {
  ticketActivity: ticketActivityTemplate,
  accountCreated: (name: string, email: string, password: string, role: string, loginUrl: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto;">
      <h2>Welcome to the Vaishnavi Group Help Desk</h2>
      <p>Hi ${name}, an account has been created for you as <strong>${roleLabels[role] ?? role}</strong>.</p>
      <p>Use these credentials to sign in:</p>
      <table style="border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:6px 12px;color:#6b7280;">Email</td><td style="padding:6px 12px;font-weight:bold;">${email}</td></tr>
        <tr><td style="padding:6px 12px;color:#6b7280;">Temporary password</td><td style="padding:6px 12px;font-weight:bold;">${password}</td></tr>
      </table>
      <p style="margin:24px 0;">
        <a href="${loginUrl}" style="background:#4f46e5;color:#fff;padding:10px 22px;border-radius:6px;text-decoration:none;display:inline-block;">Sign In</a>
      </p>
      <p style="font-size:12px;color:#6b7280;">For your security, please change your password after your first login (Profile &rarr; Change Password).</p>
    </div>
  `,
  signupOtp: (otp: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Verify your email</h2>
      <p>Use the following one-time code to complete your sign up. This code expires in 10 minutes.</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px;background:#f3f4f6;padding:12px 20px;border-radius:8px;text-align:center;">${otp}</p>
      <p>If you did not request this, you can safely ignore this email.</p>
    </div>
  `,
  passwordResetOtp: (otp: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Reset your password</h2>
      <p>Use the following one-time code to reset your password. This code expires in 10 minutes.</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px;background:#f3f4f6;padding:12px 20px;border-radius:8px;text-align:center;">${otp}</p>
      <p>If you did not request this, you can safely ignore this email — your password will stay the same.</p>
    </div>
  `,
  passwordReset: (resetUrl: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Reset your password</h2>
      <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
      <p><a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Reset Password</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    </div>
  `,
  ticketCreated: (ticketNumber: string, title: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Ticket Created: ${ticketNumber}</h2>
      <p>Your ticket "<strong>${title}</strong>" has been created successfully. Our team will review it shortly.</p>
    </div>
  `,
  ticketStatusChanged: (ticketNumber: string, status: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Ticket Update: ${ticketNumber}</h2>
      <p>The status of your ticket has been changed to <strong>${status}</strong>.</p>
    </div>
  `,
  ticketAssigned: (ticketNumber: string, agentName: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>Ticket Assigned: ${ticketNumber}</h2>
      <p>This ticket has been assigned to <strong>${agentName}</strong>.</p>
    </div>
  `,
  commentAdded: (ticketNumber: string) => `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2>New Comment on ${ticketNumber}</h2>
      <p>A new comment has been added to your ticket. Log in to view the details.</p>
    </div>
  `,
};
