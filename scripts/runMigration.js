import dns from 'node:dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { runMigration } from '../services/inventory/migrationService.js';

dotenv.config();

/**
 * Node CLI runner for the Phase 1 inventory migration.
 *
 *   cd Backend
 *   node scripts/runMigration.js
 *
 * Idempotent — safe to run repeatedly. Never creates duplicate records.
 */
async function main() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI is not set. Check Backend/.env');
    process.exit(1);
  }

  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 60000,
    });
    console.log('✅ Connected.\n');

    console.log('── Starting idempotent inventory migration ──');
    const stats = await runMigration();
    console.log('\n── Migration result ──');
    console.table?.(stats) ?? console.log(stats);
    console.log('\n🎉 Migration complete.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

main();