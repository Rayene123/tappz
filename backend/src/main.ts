import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

let app: NestFastifyApplication;

async function bootstrap() {
  if (!app) {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: true }),
    );

    app.enableCors({
      origin: process.env.FRONTEND_URL ?? '*',
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['X-Session-Id'],
      credentials: false,
    });

    await app.init();
  }
  return app;
}

// For Vercel serverless
export default async function handler(req: any, res: any) {
  const app = await bootstrap();
  const instance = app.getHttpAdapter().getInstance();
  instance.ready(() => {
    instance.server.emit('request', req, res);
  });
}

// For local dev
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  bootstrap().then(async (app) => {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    await app.listen(port, '0.0.0.0');
    console.log(`🚀 Server running on http://localhost:${port}`);
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}