import { NotificationType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { sendMail } from './mail.service';

interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  ticketId?: string;
  email?: { to: string; subject: string; html: string; replyTo?: string; fromName?: string };
}

export async function createNotification(input: CreateNotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      ticketId: input.ticketId,
    },
  });

  if (input.email) {
    await sendMail(input.email.to, input.email.subject, input.email.html, {
      replyTo: input.email.replyTo,
      fromName: input.email.fromName,
    });
  }

  return notification;
}

export async function notifyMany(inputs: CreateNotificationInput[]) {
  await Promise.all(inputs.map((input) => createNotification(input)));
}
