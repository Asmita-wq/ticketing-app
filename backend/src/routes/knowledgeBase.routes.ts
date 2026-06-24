import { Router } from 'express';
import slugify from '../utils/slugify';
import { prisma } from '../config/prisma';
import { ApiError } from '../utils/ApiError';
import { authenticate, authorize, ADMIN_ROLES } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { upload } from '../middlewares/upload';
import { getPaginationParams, buildPaginatedResult } from '../utils/pagination';
import {
  createArticleSchema,
  updateArticleSchema,
  listArticlesQuerySchema,
} from '../validators/knowledgeBase.validators';
import { Prisma } from '@prisma/client';

export const knowledgeBaseRoutes = Router();

// Public-ish: any authenticated user can browse published articles
knowledgeBaseRoutes.get('/', authenticate, validate({ query: listArticlesQuerySchema }), async (req, res) => {
  const query = req.query as { page?: number; limit?: number; category?: string; search?: string };
  const { page, limit, skip } = getPaginationParams(query);

  const isStaff = ['ADMIN', 'MANAGER', 'SUPPORT_AGENT'].includes(req.user!.role);

  const where: Prisma.KnowledgeBaseArticleWhereInput = {};
  if (!isStaff) where.isPublished = true;
  if (query.category) where.category = query.category;
  if (query.search) {
    where.OR = [
      { title: { contains: query.search, mode: 'insensitive' } },
      { content: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.knowledgeBaseArticle.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, name: true } } },
    }),
    prisma.knowledgeBaseArticle.count({ where }),
  ]);

  res.json({ success: true, ...buildPaginatedResult(data, total, page, limit) });
});

knowledgeBaseRoutes.get('/:slug', authenticate, async (req, res) => {
  const article = await prisma.knowledgeBaseArticle.findUnique({
    where: { slug: req.params.slug },
    include: { author: { select: { id: true, name: true } }, attachments: true },
  });
  if (!article) throw ApiError.notFound('Article not found');

  await prisma.knowledgeBaseArticle.update({
    where: { id: article.id },
    data: { views: { increment: 1 } },
  });

  res.json({ success: true, data: article });
});

knowledgeBaseRoutes.post(
  '/',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: createArticleSchema }),
  async (req, res) => {
    const slug = slugify(req.body.title);
    const article = await prisma.knowledgeBaseArticle.create({
      data: { ...req.body, slug, authorId: req.user!.sub },
    });
    res.status(201).json({ success: true, data: article });
  },
);

knowledgeBaseRoutes.patch(
  '/:id',
  authenticate,
  authorize(...ADMIN_ROLES),
  validate({ body: updateArticleSchema }),
  async (req, res) => {
    const data: Prisma.KnowledgeBaseArticleUpdateInput = { ...req.body };
    if (req.body.title) data.slug = slugify(req.body.title);

    const article = await prisma.knowledgeBaseArticle.update({
      where: { id: req.params.id },
      data,
    });
    res.json({ success: true, data: article });
  },
);

knowledgeBaseRoutes.delete('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  await prisma.knowledgeBaseArticle.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Article deleted' });
});

// Upload an attachment (video, pdf, image, doc) to an article
knowledgeBaseRoutes.post(
  '/:id/attachments',
  authenticate,
  authorize(...ADMIN_ROLES),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) throw ApiError.badRequest('No file uploaded');
    const article = await prisma.knowledgeBaseArticle.findUnique({ where: { id: req.params.id } });
    if (!article) throw ApiError.notFound('Article not found');

    const attachment = await prisma.kbAttachment.create({
      data: {
        articleId: article.id,
        fileName: req.file.originalname,
        filePath: `/uploads/${req.file.filename}`,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      },
    });
    res.status(201).json({ success: true, data: attachment });
  },
);

knowledgeBaseRoutes.delete('/attachments/:attId', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  await prisma.kbAttachment.delete({ where: { id: req.params.attId } });
  res.json({ success: true, message: 'Attachment deleted' });
});
