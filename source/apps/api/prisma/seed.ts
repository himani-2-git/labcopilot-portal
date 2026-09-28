import { PrismaClient } from '@prisma/client';
import { seedDemoUsers } from '../src/seed';
import { seedDemoCatalog } from '../src/laboratory/seed';
import { seedDemoResults } from '../src/results/seed';
const db = new PrismaClient();
seedDemoUsers(db, process.env.DEMO_PASSWORD ?? '')
  .then(() => seedDemoCatalog(db))
  .then(() => seedDemoResults(db))
  .then(() => console.info('Seeded synthetic staff, catalog, pre-analytical workflow and analytical result scenarios.'))
  .catch(error => { console.error(error instanceof Error ? error.message : 'Seed failed.'); process.exitCode = 1; })
  .finally(() => db.$disconnect());
