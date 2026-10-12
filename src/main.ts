import 'reflect-metadata';
import { ClassSerializerInterceptor, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { allowedOrigins, csrfOriginGuard } from './modules/auth/presentation/session-cookie';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const cfg = app.get(ConfigService);
  const logger = app.get(Logger);
  app.useLogger(logger);

  app.set('trust proxy', 1); // IP real atrás de load balancer (logs/auditoria/throttling)
  app.use(helmet());
  const origins = cfg.get<string>('CORS_ORIGINS', '*');
  if (cfg.get('NODE_ENV') === 'production' && origins === '*') throw new Error('CORS_ORIGINS não pode ser "*" em produção');
  app.use(csrfOriginGuard(allowedOrigins(cfg)));
  app.enableCors({ origin: origins === '*' ? true : origins.split(',').map((o) => o.trim()), credentials: true, exposedHeaders: ['x-request-id', 'Idempotent-Replayed', 'Content-Disposition'] });
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableVersioning({ type: VersioningType.HEADER, header: 'x-api-version' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos não declarados nos DTOs (mass assignment)
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  app.enableShutdownHooks(); // fecha pool de BD e termina jobs com graça (SIGTERM)

  const swagger = new DocumentBuilder()
    .setTitle('Cobra Aqui API')
    .setDescription(
      'API de gestão de cobranças. Todas as rotas exigem JWT (Bearer) excepto login e recuperação de palavra-passe. ' +
        'Valores monetários trafegam como string decimal ("1234.50"). Operações financeiras aceitam/exigem o header Idempotency-Key.',
    )
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger), {
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  });

  const port = cfg.get<number>('PORT', 3333);
  await app.listen(port, '0.0.0.0');
  logger.log(`API em http://localhost:${port}/api — Swagger em /api/docs`, 'Bootstrap');
}

void bootstrap();
