import { buildApp } from './app.js';
import { config } from './config.js';
import { closeAllPools } from './db/pool.js';

async function main() {
  const app = await buildApp();
  const shutdown = async () => {
    await app.close();
    await closeAllPools();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
