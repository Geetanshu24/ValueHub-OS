import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { jwtSecret } from './common/auth/jwt-config.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Fail at boot, not on the first login, if the signing secret is unusable.
  jwtSecret();

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5174').split(',');
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3100);
}

await bootstrap();
