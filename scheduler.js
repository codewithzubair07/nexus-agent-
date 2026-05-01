// ============================================================
// scheduler.js — Automated Cron Jobs via node-cron
//
// Jobs:
//   1. Every 30 min — check Gmail for new unread emails,
//      notify the owner on WhatsApp with a summary.
//   2. Every day at 8:00 AM — send a daily morning summary
//      to the owner (unread email count + pending tasks).
// ============================================================

import cron from 'node-cron';
import dotenv from 'dotenv';

import { getUnreadEmails, getUnreadCount, formatEmailsForWhatsApp } from './gmail.js';
import { summarizeEmails } from './ai.js';
import { getPendingTasks } from './db.js';
import { sendMessage } from './whatsapp.js';

dotenv.config();

// Maximum number of tasks to include in the daily summary
const MAX_TASKS_IN_SUMMARY = 10;
// The OWNER_PHONE env var should be the full phone number
// without the + sign (e.g. 919876543210 for +91 9876543210).
const OWNER_JID = `${process.env.OWNER_PHONE}@s.whatsapp.net`;

// ── Keep track of the last email count to avoid duplicate pings ─
let lastKnownEmailCount = 0;

// ─────────────────────────────────────────────────────────────
// JOB 1 — Gmail Check Every 30 Minutes
// Cron syntax: "*/30 * * * *" = every 30 minutes
// ─────────────────────────────────────────────────────────────
export function startEmailWatcher() {
  cron.schedule('*/30 * * * *', async () => {
    console.log('[Scheduler] ⏰ Running Gmail check...');

    try {
      const currentCount = await getUnreadCount();

      // Only notify if there are NEW emails since the last check
      if (currentCount > lastKnownEmailCount) {
        const newCount = currentCount - lastKnownEmailCount;
        console.log(`[Scheduler] 📬 ${newCount} new unread email(s) detected`);

        // Fetch up to 5 of the latest emails for summarization
        const emails = await getUnreadEmails(5);

        // Let the AI summarize the email batch
        const summary = await summarizeEmails(emails);

        const notification =
          `📬 *${newCount} new email(s) arrived!*\n\n` +
          `${summary}\n\n` +
          `Reply *!email* for the full list.`;

        await sendMessage(OWNER_JID, notification);
        lastKnownEmailCount = currentCount;
      } else {
        console.log('[Scheduler] 📭 No new emails since last check.');
      }
    } catch (err) {
      console.error('[Scheduler] Email watcher error:', err.message);
    }
  });

  console.log('[Scheduler] ✅ Email watcher started (every 30 minutes)');
}

// ─────────────────────────────────────────────────────────────
// JOB 2 — Daily Morning Summary at 8:00 AM
// Cron syntax: "0 8 * * *" = 8:00 AM every day
// Change the timezone in the options object if needed.
// ─────────────────────────────────────────────────────────────
export function startDailySummary() {
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('[Scheduler] 🌅 Sending daily morning summary...');

      try {
        // ── Get unread email count ──────────────────────────
        const emailCount = await getUnreadCount();

        // ── Get pending tasks from SQLite ──────────────────
        const tasks = getPendingTasks();
        const taskLines = tasks.length > 0
          ? tasks.slice(0, MAX_TASKS_IN_SUMMARY).map((t, i) => `${i + 1}. ${t.title}`).join('\n')
          : 'No pending tasks 🎉';

        // ── Build the morning summary message ──────────────
        const summary =
          `🌅 *Good Morning! Here's your Nexus Daily Summary*\n\n` +
          `📬 *Unread Emails:* ${emailCount}\n\n` +
          `📋 *Pending Tasks:*\n${taskLines}\n\n` +
          `Have a productive day! 🚀 — Nexus`;

        await sendMessage(OWNER_JID, summary);
        console.log('[Scheduler] ✅ Daily summary sent.');
      } catch (err) {
        console.error('[Scheduler] Daily summary error:', err.message);
      }
    },
    {
      // Set this to your timezone (e.g. 'Asia/Kolkata' for IST)
      timezone: process.env.TIMEZONE || 'Asia/Kolkata',
    }
  );

  console.log('[Scheduler] ✅ Daily summary scheduled at 8:00 AM');
}

/**
 * Start all scheduled jobs.
 * Called once from index.js after the WhatsApp socket is ready.
 */
export function startAllJobs() {
  startEmailWatcher();
  startDailySummary();
  console.log('[Scheduler] 🎯 All cron jobs are running.');
}
