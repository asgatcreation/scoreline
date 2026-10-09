import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';
import { directDatabaseUrl } from './src/database/database-url.js';

// Local development reads apps/api/.env; on Render the variables are already set.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations must use Neon's direct (non-pooled) connection.
    url: directDatabaseUrl() ?? '',
  },
});
