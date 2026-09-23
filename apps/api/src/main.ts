import { env } from "@aideal/env";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";
import { isAllowedCorsOrigin } from "./cors-policy";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  const allowedOrigins = new Set(
    env.API_CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
      if (isAllowedCorsOrigin(origin, allowedOrigins)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed"), false);
    },
    credentials: true,
  });

  await app.listen(env.API_PORT);
}

void bootstrap();
