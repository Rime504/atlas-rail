import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';

async function generateOpenApiJson() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  const config = new DocumentBuilder()
    .setTitle('Atlas Rail OpenAPI Specification')
    .setDescription('Programmable treasury controls and safe USDC payouts for Solana devnet.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  const docsDir = path.resolve(__dirname, '../../../../docs/api');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = path.join(docsDir, 'openapi.json');
  fs.writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');

  console.info(`✅ Generated checked-in OpenAPI specification at ${outputPath}`);
  await app.close();
  process.exit(0);
}

generateOpenApiJson().catch((err) => {
  console.error('Failed to generate OpenAPI JSON:', err);
  process.exit(1);
});
