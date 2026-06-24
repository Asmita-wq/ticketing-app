import 'express-async-errors';
import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiRouter } from './routes';

export function createApp(): Application {
  const app = express();

  // Behind a reverse proxy (nginx / load balancer) in production so that
  // req.ip and rate limiting use the real client IP from X-Forwarded-For.
  if (env.isProd) app.set('trust proxy', 1);

  // Allow uploaded files (images/video in tickets & KB) to be embedded by the website.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow non-browser clients (curl, server-to-server) with no Origin header,
        // and any explicitly allow-listed origin.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));

  // General API rate limit
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  // Stricter limit on auth endpoints to resist brute-force / credential stuffing
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many attempts. Please try again later.' },
  });
  app.use('/api/v1/auth', authLimiter);

  app.use('/uploads', express.static(path.resolve(process.cwd(), env.uploads.dir)));

  app.get('/health', (_req, res) => {
    res.json({ success: true, status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
