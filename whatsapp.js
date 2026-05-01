// ============================================================
// whatsapp.js — Baileys WhatsApp Connection + Message Handler
//
// Handles:
//   • QR code display for first-time pairing
//   • Persistent auth state (saved to auth_info/ folder)
//   • Listening to all incoming DM and group messages
//   • Routing messages to the AI brain (ai.js)
//   • Processing bot commands (!help, !summarize, !contacts, !email)
//   • Saving contacts to SQLite CRM (db.js)
//   • fetchLatestWaWebVersion() to stay compatible with WhatsApp
// ============================================================

import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  Browsers,
} from '@whiskeysockets/baileys';

import qrcode from 'qrcode-terminal';
import pino   from 'pino';
import path   from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { askAI, summarizeChat } from './ai.js';
import { getUnreadEmails, formatEmailsForWhatsApp } from './gmail.js';
import { upsertContact, getAllContacts, getRecentMessages, logMessage } from './db.js';

dotenv.config();

// ── Resolve __dirname for ES Modules ─────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Maximum character lengths for CRM contact and chat log storage
const MAX_CONTACT_MESSAGE_LENGTH = 255;
const MAX_LOG_MESSAGE_LENGTH     = 500;
// Delete this folder to force a fresh QR scan.
const AUTH_FOLDER = path.join(__dirname, 'auth_info');

// ── Global socket reference — exported so scheduler can use it ─
export let sock = null;

// ─────────────────────────────────────────────────────────────
// COMMAND HANDLERS
// ─────────────────────────────────────────────────────────────

/**
 * !help — show available bot commands
 */
function handleHelp() {
  return (
    `🤖 *Nexus Command Menu*\n\n` +
    `• *!help*       — show this menu\n` +
    `• *!summarize*  — summarize last 20 messages in this chat\n` +
    `• *!contacts*   — list all saved contacts (owner only)\n` +
    `• *!email*      — show latest 5 unread emails (owner only)\n\n` +
    `Powered by *Architect Nexus* ⚡`
  );
}

/**
 * !contacts — list all CRM contacts (owner only)
 */
function handleContacts(senderJid) {
  // Only the owner (OWNER_PHONE) can see contacts
  const ownerJid = `${process.env.OWNER_PHONE}@s.whatsapp.net`;
  if (senderJid !== ownerJid) {
    return '🔒 This command is only available to the bot owner.';
  }

  const contacts = getAllContacts();
  if (contacts.length === 0) {
    return '📭 No contacts saved yet.';
  }

  const lines = contacts.slice(0, 20).map((c, i) =>
    `${i + 1}. *${c.name || 'Unknown'}* — ${c.phone}\n` +
    `   Last msg: ${c.last_message?.slice(0, 50) || '—'}\n` +
    `   Updated: ${c.updated_at}`
  );

  return `*📋 Saved Contacts (${contacts.length} total):*\n\n${lines.join('\n\n')}`;
}

/**
 * !summarize — summarize recent messages in this chat
 *
 * @param {string} chatId
 * @returns {Promise<string>}
 */
async function handleSummarize(chatId) {
  try {
    const messages = getRecentMessages(chatId, 20);
    if (messages.length < 3) {
      return '📭 Not enough messages to summarize yet!';
    }
    const summary = await summarizeChat(messages);
    return `*📝 Chat Summary:*\n\n${summary}`;
  } catch (err) {
    console.error('[WA] handleSummarize error:', err.message);
    return 'Could not generate summary right now 😅';
  }
}

/**
 * !email — fetch and display latest unread emails (owner only)
 *
 * @param {string} senderJid
 * @returns {Promise<string>}
 */
async function handleEmail(senderJid) {
  const ownerJid = `${process.env.OWNER_PHONE}@s.whatsapp.net`;
  if (senderJid !== ownerJid) {
    return '🔒 This command is only available to the bot owner.';
  }

  try {
    const emails = await getUnreadEmails(5);
    return formatEmailsForWhatsApp(emails);
  } catch (err) {
    console.error('[WA] handleEmail error:', err.message);
    return 'Could not fetch emails right now 😅';
  }
}

// ─────────────────────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────────────────────

/**
 * Process an incoming WhatsApp message.
 * Handles commands and routes everything else to the AI brain.
 *
 * @param {object} msg      - raw Baileys message object
 * @param {object} sockRef  - the active socket for sending replies
 */
async function handleMessage(msg, sockRef) {
  try {
    // ── Extract key fields from the message ──────────────────
    const chatId    = msg.key.remoteJid;                          // chat JID
    const senderJid = msg.key.participant || msg.key.remoteJid;   // sender JID
    const isFromMe  = msg.key.fromMe;                             // did the bot send this?
    const body      = msg.message?.conversation
                   || msg.message?.extendedTextMessage?.text
                   || '';

    // ── Ignore messages sent by the bot itself ───────────────
    if (isFromMe || !body.trim()) return;

    // ── Ignore status broadcasts ──────────────────────────────
    if (chatId === 'status@broadcast') return;

    console.log(`[WA] Message from ${senderJid} in ${chatId}: ${body.slice(0, 80)}`);

    // ── Save contact to CRM ───────────────────────────────────
    upsertContact(senderJid, body.slice(0, MAX_CONTACT_MESSAGE_LENGTH));

    // ── Log message for !summarize command ───────────────────
    logMessage(chatId, senderJid, body.slice(0, MAX_LOG_MESSAGE_LENGTH));

    // ── Route to command handlers or AI brain ────────────────
    let reply = '';
    const cmd = body.trim().toLowerCase();

    if (cmd.startsWith('!help')) {
      reply = handleHelp();
    } else if (cmd.startsWith('!contacts')) {
      reply = handleContacts(senderJid);
    } else if (cmd.startsWith('!summarize')) {
      reply = await handleSummarize(chatId);
    } else if (cmd.startsWith('!email')) {
      reply = await handleEmail(senderJid);
    } else {
      // Default: send to the AI brain for a conversational reply
      reply = await askAI(chatId, body);
    }

    // ── Send the reply ────────────────────────────────────────
    if (reply) {
      await sockRef.sendMessage(chatId, { text: reply });
    }
  } catch (err) {
    console.error('[WA] handleMessage error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SEND MESSAGE HELPER (used by scheduler.js)
// ─────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message to any JID.
 * Exported so the scheduler can push daily summaries.
 *
 * @param {string} jid     - recipient JID (e.g. "919876543210@s.whatsapp.net")
 * @param {string} message - text to send
 */
export async function sendMessage(jid, message) {
  try {
    if (!sock) {
      console.warn('[WA] sendMessage called before socket is ready');
      return;
    }
    await sock.sendMessage(jid, { text: message });
    console.log(`[WA] Sent message to ${jid}`);
  } catch (err) {
    console.error('[WA] sendMessage error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CONNECTION BOOTSTRAP
// ─────────────────────────────────────────────────────────────

/**
 * Connect to WhatsApp using Baileys.
 * • Loads (or creates) auth state from AUTH_FOLDER
 * • Fetches the latest WhatsApp Web version dynamically
 *   (prevents HTTP 405 errors after WhatsApp protocol updates)
 * • Displays a QR code in the terminal for first-time pairing
 * • Reconnects automatically on non-fatal disconnects
 */
export async function connectToWhatsApp() {
  try {
    // ── Load persistent auth state ────────────────────────────
    // Baileys saves multi-file keys in AUTH_FOLDER.
    // If the folder doesn't exist it's created automatically.
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    // ── Fetch the latest WhatsApp Web version ─────────────────
    // This avoids the HTTP 405 "Bad Client Version" error that
    // happens when Baileys' hardcoded version becomes stale.
    const { version, isLatest } = await fetchLatestWaWebVersion();
    console.log(`[WA] Using WA Web version ${version.join('.')} (latest: ${isLatest})`);

    // ── Create the socket ─────────────────────────────────────
    sock = makeWASocket({
      version,                          // use the live WA Web version
      auth:                state,       // restore saved session
      browser:             Browsers.windows('Chrome'), // mimic a browser
      markOnlineOnConnect: false,       // stay invisible
      syncFullHistory:     false,       // faster startup
      logger:              pino({ level: 'silent' }), // silence internal logs
    });

    // ── Save credentials whenever they update ─────────────────
    sock.ev.on('creds.update', saveCreds);

    // ── Handle connection updates ─────────────────────────────
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // Show QR code in terminal for first-time pairing
      if (qr) {
        console.log('\n[WA] 📱 Scan this QR code with WhatsApp:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        // Check if the disconnect is recoverable
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(
          `[WA] Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`
        );

        if (shouldReconnect) {
          // Wait 3 seconds then reconnect
          setTimeout(connectToWhatsApp, 3000);
        } else {
          // Logged out — user needs to re-scan QR
          console.log('[WA] ❌ Logged out. Delete auth_info/ and restart to re-pair.');
        }
      }

      if (connection === 'open') {
        console.log('[WA] ✅ Connected to WhatsApp!');
      }
    });

    // ── Listen for incoming messages ──────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      // 'notify' = new incoming messages; 'append' = history sync
      if (type !== 'notify') return;

      for (const msg of messages) {
        await handleMessage(msg, sock);
      }
    });
  } catch (err) {
    console.error('[WA] connectToWhatsApp error:', err.message);
    // Retry after 5 seconds on unexpected errors
    setTimeout(connectToWhatsApp, 5000);
  }
}
