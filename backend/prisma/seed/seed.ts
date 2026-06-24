import { PrismaClient, TicketPriority } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SLA_DEFAULTS: { priority: TicketPriority; responseTimeMins: number; resolutionTimeMins: number }[] = [
  { priority: 'CRITICAL', responseTimeMins: 60, resolutionTimeMins: 240 },
  { priority: 'HIGH', responseTimeMins: 240, resolutionTimeMins: 720 },
  { priority: 'MEDIUM', responseTimeMins: 480, resolutionTimeMins: 1440 },
  { priority: 'LOW', responseTimeMins: 1440, resolutionTimeMins: 4320 },
];

async function main() {
  console.log('Seeding database...');

  // ---- SLA Configurations ----
  for (const config of SLA_DEFAULTS) {
    await prisma.sLAConfiguration.upsert({
      where: { priority: config.priority },
      update: config,
      create: config,
    });
  }

  // ---- Categories & Subcategories ----
  const categoriesData = [
    { name: 'Hardware', subcategories: ['Laptop', 'Desktop', 'Printer', 'Peripherals'] },
    { name: 'Software', subcategories: ['Operating System', 'Application Issue', 'License Request'] },
    { name: 'Network', subcategories: ['Internet', 'VPN', 'Wi-Fi', 'LAN'] },
    { name: 'Account & Access', subcategories: ['Password Reset', 'New Account', 'Permissions'] },
    { name: 'Billing', subcategories: ['Invoice', 'Subscription', 'Refund'] },
  ];

  for (const cat of categoriesData) {
    const category = await prisma.category.upsert({
      where: { name: cat.name },
      update: {},
      create: { name: cat.name },
    });

    for (const sub of cat.subcategories) {
      await prisma.subcategory.upsert({
        where: { categoryId_name: { categoryId: category.id, name: sub } },
        update: {},
        create: { name: sub, categoryId: category.id },
      });
    }
  }

  // ---- Users ----
  const passwordHash = await bcrypt.hash('Password@123', 10);

  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@helpdesk.com' },
    update: {},
    create: {
      name: 'Admin User',
      email: 'admin@helpdesk.com',
      password: passwordHash,
      role: 'ADMIN',
      emailVerified: true,
      department: 'IT Administration',
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: 'manager@helpdesk.com' },
    update: {},
    create: {
      name: 'Manager User',
      email: 'manager@helpdesk.com',
      password: passwordHash,
      role: 'MANAGER',
      emailVerified: true,
      department: 'IT Administration',
    },
  });

  const agent1 = await prisma.user.upsert({
    where: { email: 'agent1@helpdesk.com' },
    update: {},
    create: {
      name: 'Alice Agent',
      email: 'agent1@helpdesk.com',
      password: passwordHash,
      role: 'SUPPORT_AGENT',
      emailVerified: true,
      department: 'Support',
    },
  });

  const agent2 = await prisma.user.upsert({
    where: { email: 'agent2@helpdesk.com' },
    update: {},
    create: {
      name: 'Bob Agent',
      email: 'agent2@helpdesk.com',
      password: passwordHash,
      role: 'SUPPORT_AGENT',
      emailVerified: true,
      department: 'Support',
    },
  });

  const user1 = await prisma.user.upsert({
    where: { email: 'user1@example.com' },
    update: {},
    create: {
      name: 'John Customer',
      email: 'user1@example.com',
      password: passwordHash,
      role: 'USER',
      emailVerified: true,
      phone: '+1-555-0100',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'user2@example.com' },
    update: {},
    create: {
      name: 'Jane Customer',
      email: 'user2@example.com',
      password: passwordHash,
      role: 'USER',
      emailVerified: true,
      phone: '+1-555-0101',
    },
  });

  // ---- Knowledge Base Articles ----
  const articles = [
    {
      title: 'How to Reset Your Password',
      content: '<p>To reset your password, go to the login page and click "Forgot Password". Follow the instructions sent to your email.</p>',
      category: 'Account & Access',
      tags: ['password', 'login', 'faq'],
    },
    {
      title: 'Connecting to the Company VPN',
      content: '<p>Download the VPN client from the IT portal, install it, and use your company credentials to connect.</p>',
      category: 'Network',
      tags: ['vpn', 'network', 'guide'],
    },
    {
      title: 'Requesting New Software Licenses',
      content: '<p>Submit a ticket under Software > License Request with the software name and business justification.</p>',
      category: 'Software',
      tags: ['software', 'license'],
    },
  ];

  for (const article of articles) {
    const slug = article.title.toLowerCase().replace(/\s+/g, '-');
    await prisma.knowledgeBaseArticle.upsert({
      where: { slug },
      update: {},
      create: { ...article, slug, authorId: admin.id },
    });
  }

  // ---- Sample Tickets ----
  const hardwareCategory = await prisma.category.findUnique({ where: { name: 'Hardware' } });
  const networkCategory = await prisma.category.findUnique({ where: { name: 'Network' } });
  const accountCategory = await prisma.category.findUnique({ where: { name: 'Account & Access' } });

  const now = new Date();
  const year = now.getFullYear();

  const ticketsData = [
    {
      ticketNumber: `TKT-${year}-000001`,
      title: 'Laptop screen flickering intermittently',
      description: 'My laptop screen flickers every few minutes, especially when on battery power.',
      categoryId: hardwareCategory!.id,
      priority: 'HIGH' as TicketPriority,
      status: 'IN_PROGRESS' as const,
      createdById: user1.id,
      assignedToId: agent1.id,
    },
    {
      ticketNumber: `TKT-${year}-000002`,
      title: 'Cannot connect to office VPN',
      description: 'VPN client shows "connection timed out" error since this morning.',
      categoryId: networkCategory!.id,
      priority: 'CRITICAL' as TicketPriority,
      status: 'OPEN' as const,
      createdById: user2.id,
      assignedToId: null,
    },
    {
      ticketNumber: `TKT-${year}-000003`,
      title: 'Need password reset for ERP system',
      description: 'I am locked out of the ERP system after multiple failed login attempts.',
      categoryId: accountCategory!.id,
      priority: 'MEDIUM' as TicketPriority,
      status: 'RESOLVED' as const,
      createdById: user1.id,
      assignedToId: agent2.id,
    },
  ];

  for (const t of ticketsData) {
    const existing = await prisma.ticket.findUnique({ where: { ticketNumber: t.ticketNumber } });
    if (existing) continue;

    const responseDueAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const resolutionDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await prisma.ticket.create({
      data: {
        ticketNumber: t.ticketNumber,
        title: t.title,
        description: t.description,
        categoryId: t.categoryId,
        priority: t.priority,
        status: t.status,
        createdById: t.createdById,
        assignedToId: t.assignedToId ?? undefined,
        responseDueAt,
        resolutionDueAt,
        resolvedAt: t.status === 'RESOLVED' ? now : null,
        statusHistory: {
          create: { toStatus: 'OPEN', changedById: t.createdById, note: 'Ticket created (seed)' },
        },
      },
    });
  }

  console.log('Seed completed successfully.');
  console.log('---------------------------------------------');
  console.log('Login credentials (password for all: Password@123)');
  console.log(`Admin:    ${superAdmin.email}`);
  console.log(`Manager:  ${admin.email}`);
  console.log(`Agent 1:     ${agent1.email}`);
  console.log(`Agent 2:     ${agent2.email}`);
  console.log(`User 1:      ${user1.email}`);
  console.log(`User 2:      ${user2.email}`);
  console.log('---------------------------------------------');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
