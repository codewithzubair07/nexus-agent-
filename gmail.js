// ============================================================
// gmail.js — Gmail API Integration
// Reads unread emails and builds notification summaries.
// Requires a Google OAuth2 credentials file and refresh token.
// ============================================================

import { google } from 'googleapis';
import fs          from 'fs';
import path        from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// ── Resolve __dirname for ES Modules ─────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Build an OAuth2 client from environment variables ─────────
// All credentials must be set in your .env file.
function createOAuth2Client() {
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,      // from Google Cloud Console
    process.env.GMAIL_CLIENT_SECRET,  // from Google Cloud Console
    process.env.GMAIL_REDIRECT_URI    // usually "urn:ietf:wg:oauth:2.0:oob"
  );

  // Set the refresh token so we don't need to re-authenticate manually
  oAuth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
  });

  return oAuth2Client;
}

// ── Initialise the Gmail API client ───────────────────────────
let gmailClient = null;

function getGmailClient() {
  if (!gmailClient) {
    try {
      const auth = createOAuth2Client();
      gmailClient = google.gmail({ version: 'v1', auth });
    } catch (err) {
      console.error('[Gmail] Failed to create Gmail client:', err.message);
    }
  }
  return gmailClient;
}

/**
 * Decode a base64url-encoded Gmail message body.
 *
 * @param {string} data - base64url string from Gmail API
 * @returns {string} - decoded text
 */
function decodeBase64Url(data) {
  try {
    // Gmail uses base64url encoding (replaces + with - and / with _)
    const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

/**
 * Extract plain-text body from a Gmail message payload.
 * Handles multipart messages recursively.
 *
 * @param {object} payload - message payload from Gmail API
 * @returns {string}
 */
function extractBody(payload) {
  try {
    if (!payload) return '';

    // Single-part message — body is directly on the payload
    if (payload.body?.data) {
      return decodeBase64Url(payload.body.data);
    }

    // Multi-part message — recurse through parts
    if (payload.parts && payload.parts.length > 0) {
      for (const part of payload.parts) {
        // Prefer plain text over HTML
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return decodeBase64Url(part.body.data);
        }
      }
      // Fall back to first part with data
      for (const part of payload.parts) {
        const body = extractBody(part);
        if (body) return body;
      }
    }

    return '';
  } catch {
    return '';
  }
}

/**
 * Extract a specific header value from an email message.
 *
 * @param {Array} headers - array of { name, value } objects
 * @param {string} name   - header name (e.g. 'Subject', 'From')
 * @returns {string}
 */
function getHeader(headers, name) {
  const header = (headers || []).find(
    h => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value || '';
}

/**
 * Fetch the latest unread emails from Gmail.
 *
 * @param {number} [maxResults=5] - how many emails to fetch
 * @returns {Promise<Array<{id, subject, from, date, snippet, body}>>}
 */
export async function getUnreadEmails(maxResults = 5) {
  try {
    const gmail = getGmailClient();
    if (!gmail) {
      console.error('[Gmail] Client not available');
      return [];
    }

    // List unread message IDs from the inbox
    const listRes = await gmail.users.messages.list({
      userId:   'me',
      q:        'is:unread in:inbox',  // only unread inbox emails
      maxResults,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) return [];

    // Fetch full details for each message in parallel
    const emailPromises = messages.map(async ({ id }) => {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'full',
        });

        const msg     = msgRes.data;
        const headers = msg.payload?.headers || [];

        return {
          id,
          subject: getHeader(headers, 'Subject') || '(no subject)',
          from:    getHeader(headers, 'From')    || '(unknown sender)',
          date:    getHeader(headers, 'Date')    || '',
          snippet: msg.snippet || '',
          body:    extractBody(msg.payload),
        };
      } catch (err) {
        console.error(`[Gmail] Error fetching message ${id}:`, err.message);
        return null;
      }
    });

    // Filter out any null results from failed fetches
    const emails = (await Promise.all(emailPromises)).filter(Boolean);
    return emails;
  } catch (err) {
    console.error('[Gmail] getUnreadEmails error:', err.message);
    return [];
  }
}

/**
 * Count total unread emails in the inbox.
 *
 * @returns {Promise<number>}
 */
export async function getUnreadCount() {
  try {
    const gmail = getGmailClient();
    if (!gmail) return 0;

    const res = await gmail.users.messages.list({
      userId:     'me',
      q:          'is:unread in:inbox',
      maxResults: 1,
    });

    // Gmail returns resultSizeEstimate — use it as a fast count
    return res.data.resultSizeEstimate || 0;
  } catch (err) {
    console.error('[Gmail] getUnreadCount error:', err.message);
    return 0;
  }
}

/**
 * Mark an email as read by removing the UNREAD label.
 *
 * @param {string} messageId - Gmail message ID
 * @returns {Promise<void>}
 */
export async function markAsRead(messageId) {
  try {
    const gmail = getGmailClient();
    if (!gmail) return;

    await gmail.users.messages.modify({
      userId:       'me',
      id:           messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });
  } catch (err) {
    console.error(`[Gmail] markAsRead error for ${messageId}:`, err.message);
  }
}

/**
 * Format a list of emails into a WhatsApp-friendly text block.
 *
 * @param {Array} emails - returned from getUnreadEmails()
 * @returns {string}
 */
export function formatEmailsForWhatsApp(emails) {
  if (!emails || emails.length === 0) {
    return '📭 No unread emails right now!';
  }

  const lines = emails.map((e, i) =>
    `📧 *${i + 1}. ${e.subject}*\n` +
    `👤 From: ${e.from}\n` +
    `📅 ${e.date}\n` +
    `💬 ${e.snippet}`
  );

  return `*📬 Latest Unread Emails:*\n\n${lines.join('\n\n─────────────\n\n')}`;
}
