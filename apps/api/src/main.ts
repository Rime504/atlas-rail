import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe, Logger } from '@nestjs/common';
import { validateEnv, DEVNET_WARNING_BANNER } from '@atlas-rail/config';
import { assertNotMainnet } from '@atlas-rail/solana';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('AtlasRailAPI');

  // Validate environment variables on startup
  const env = validateEnv();
  assertNotMainnet(env.SOLANA_RPC_URL);

  logger.warn(`⚠️ SAFETY NOTICE: ${DEVNET_WARNING_BANNER}`);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: env.LOG_LEVEL === 'debug' }),
  );

  app.enableCors({ origin: '*' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Configure OpenAPI / Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Atlas Rail OpenAPI Specification')
    .setDescription(
      'Programmable policy controls, multi-approval governance, transaction simulation, and safe USDC payouts for Solana devnet.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = env.API_PORT;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Atlas Rail API listening on http://localhost:${port}`);
  logger.log(`📚 OpenAPI / Swagger documentation at http://localhost:${port}/docs`);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
