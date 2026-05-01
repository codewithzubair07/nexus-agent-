// ============================================================
// index.js — Nexus WhatsApp AI Agent — Entry Point
//
// This is the main file that starts everything:
//   1. Loads environment variables from .env
//   2. Connects to WhatsApp via Baileys (whatsapp.js)
//   3. Starts scheduled cron jobs (scheduler.js)
//
// To start the bot:  node index.js
// ============================================================

import dotenv from 'dotenv';

// ── Load .env first — must happen before any other imports ───
dotenv.config();

import { connectToWhatsApp } from './whatsapp.js';
import { startAllJobs }      from './scheduler.js';

// ─────────────────────────────────────────────────────────────
// VALIDATE REQUIRED ENVIRONMENT VARIABLES
// Fail fast with a clear message if anything is missing.
// ─────────────────────────────────────────────────────────────
const REQUIRED_ENV = [
  'GROQ_API_KEY',
  'OWNER_PHONE',
];

const missing = REQUIRED_ENV.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[Nexus] ❌ Missing required environment variables:\n  ${missing.join('\n  ')}\n` +
    `Please copy .env.example to .env and fill in the values.`
  );
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// Catch termination signals so the bot exits cleanly.
// ─────────────────────────────────────────────────────────────
process.on('SIGINT',  () => { console.log('\n[Nexus] Shutting down... 👋'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[Nexus] Shutting down... 👋'); process.exit(0); });

// Catch unhandled promise rejections so the process doesn't crash silently
process.on('unhandledRejection', (reason) => {
  console.error('[Nexus] Unhandled rejection:', reason);
});

// ─────────────────────────────────────────────────────────────
// START EVERYTHING
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   🤖  Nexus — WhatsApp AI Agent       ║');
  console.log('║   Powered by Architect Nexus          ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  try {
    // Step 1 — Connect to WhatsApp
    // This will display a QR code if not already paired.
    console.log('[Nexus] 🔌 Connecting to WhatsApp...');
    await connectToWhatsApp();

    // Step 2 — Start cron jobs
    // Give WhatsApp a moment to finish connecting before firing jobs.
    setTimeout(() => {
      console.log('[Nexus] ⏰ Starting scheduled jobs...');
      startAllJobs();
    }, 5000);
  } catch (err) {
    console.error('[Nexus] Fatal startup error:', err.message);
    process.exit(1);
  }
}

// Run the main function
main();
