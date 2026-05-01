// ============================================================
// db.js — SQLite Database Layer (via better-sqlite3)
// Handles all database operations: contacts, tasks, chat logs
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Resolve __dirname for ES Modules ─────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Open (or create) the SQLite file ─────────────────────────
// The DB file lives alongside this script.
const DB_PATH = path.join(__dirname, 'nexus.db');
const db = new Database(DB_PATH);

// Enable Write-Ahead Logging for better performance
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────────────────────
// TABLE: contacts
//   Stores every new person who messages the bot.
// ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    phone        TEXT    UNIQUE NOT NULL,  -- WhatsApp JID / phone
    name         TEXT,                     -- user's self-reported name
    business     TEXT,                     -- user's business type
    challenge    TEXT,                     -- their main challenge
    budget       TEXT,                     -- budget range
    last_message TEXT,                     -- last message text
    created_at   TEXT    DEFAULT (datetime('now')),
    updated_at   TEXT    DEFAULT (datetime('now'))
  )
`);

// ─────────────────────────────────────────────────────────────
// TABLE: tasks
//   Pending tasks / reminders tracked by the bot.
// ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT,
    status      TEXT    DEFAULT 'pending', -- pending | done
    due_date    TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  )
`);

// ─────────────────────────────────────────────────────────────
// TABLE: chat_logs
//   Keeps a rolling history of messages for the !summarize cmd.
// ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_logs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id    TEXT NOT NULL,   -- group or DM JID
    sender     TEXT NOT NULL,   -- sender JID
    message    TEXT NOT NULL,
    timestamp  TEXT DEFAULT (datetime('now'))
  )
`);

// ─────────────────────────────────────────────────────────────
// CONTACT OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * Upsert a contact.
 * Creates a new row if the phone doesn't exist, otherwise updates
 * last_message and updated_at.
 *
 * @param {string} phone - WhatsApp JID (e.g. "919876543210@s.whatsapp.net")
 * @param {string} lastMessage - the latest message text
 */
export function upsertContact(phone, lastMessage) {
  try {
    db.prepare(`
      INSERT INTO contacts (phone, last_message)
      VALUES (@phone, @lastMessage)
      ON CONFLICT(phone) DO UPDATE SET
        last_message = excluded.last_message,
        updated_at   = datetime('now')
    `).run({ phone, lastMessage });
  } catch (err) {
    console.error('[DB] upsertContact error:', err.message);
  }
}

/**
 * Update specific profile fields for a contact.
 * Used during the lead-qualification conversation flow.
 *
 * @param {string} phone
 * @param {object} fields - e.g. { name: 'Ali', business: 'E-commerce' }
 */
export function updateContactField(phone, fields) {
  try {
    // Build a dynamic SET clause from the fields object
    const setClauses = Object.keys(fields)
      .map(k => `${k} = @${k}`)
      .join(', ');

    db.prepare(`
      UPDATE contacts
      SET ${setClauses}, updated_at = datetime('now')
      WHERE phone = @phone
    `).run({ ...fields, phone });
  } catch (err) {
    console.error('[DB] updateContactField error:', err.message);
  }
}

/**
 * Retrieve a single contact by phone.
 *
 * @param {string} phone
 * @returns {object|null}
 */
export function getContact(phone) {
  try {
    return db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone) || null;
  } catch (err) {
    console.error('[DB] getContact error:', err.message);
    return null;
  }
}

/**
 * Retrieve all saved contacts.
 *
 * @returns {Array}
 */
export function getAllContacts() {
  try {
    return db.prepare('SELECT * FROM contacts ORDER BY updated_at DESC').all();
  } catch (err) {
    console.error('[DB] getAllContacts error:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// TASK OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * Add a new task.
 *
 * @param {string} title
 * @param {string} [description]
 * @param {string} [dueDate]
 */
export function addTask(title, description = '', dueDate = null) {
  try {
    db.prepare(`
      INSERT INTO tasks (title, description, due_date)
      VALUES (?, ?, ?)
    `).run(title, description, dueDate);
  } catch (err) {
    console.error('[DB] addTask error:', err.message);
  }
}

/**
 * Get all pending tasks.
 *
 * @returns {Array}
 */
export function getPendingTasks() {
  try {
    return db.prepare(`
      SELECT * FROM tasks WHERE status = 'pending' ORDER BY created_at ASC
    `).all();
  } catch (err) {
    console.error('[DB] getPendingTasks error:', err.message);
    return [];
  }
}

/**
 * Mark a task as done.
 *
 * @param {number} id - task ID
 */
export function completeTask(id) {
  try {
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(id);
  } catch (err) {
    console.error('[DB] completeTask error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// CHAT LOG OPERATIONS
// ─────────────────────────────────────────────────────────────

/**
 * Save a single chat message to the log.
 *
 * @param {string} chatId  - group or DM JID
 * @param {string} sender  - sender JID
 * @param {string} message - message text
 */
export function logMessage(chatId, sender, message) {
  try {
    db.prepare(`
      INSERT INTO chat_logs (chat_id, sender, message)
      VALUES (?, ?, ?)
    `).run(chatId, sender, message);
  } catch (err) {
    console.error('[DB] logMessage error:', err.message);
  }
}

/**
 * Retrieve the last N messages for a given chat.
 *
 * @param {string} chatId
 * @param {number} [limit=20]
 * @returns {Array}
 */
export function getRecentMessages(chatId, limit = 20) {
  try {
    return db.prepare(`
      SELECT sender, message, timestamp
      FROM chat_logs
      WHERE chat_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(chatId, limit).reverse();
  } catch (err) {
    console.error('[DB] getRecentMessages error:', err.message);
    return [];
  }
}

export default db;
