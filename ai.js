// ============================================================
// ai.js — Groq AI Brain for Nexus
// Sends messages to Groq (llama3-70b) with the system prompt
// and knowledge base injected into every request.
// ============================================================

import Groq from 'groq-sdk';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

// ── Resolve __dirname for ES Modules ─────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Load the knowledge base from knowledge.txt ───────────────
// This file contains FAQs and business info for the agent.
let knowledgeBase = '';
try {
  knowledgeBase = fs.readFileSync(
    path.join(__dirname, 'knowledge.txt'),
    'utf-8'
  );
} catch (err) {
  console.warn('[AI] Could not load knowledge.txt:', err.message);
}

// ── System prompt injected into every Groq request ───────────
// This defines Nexus's identity, personality, and behavior.
const SYSTEM_PROMPT = `
You are Nexus, a smart and professional WhatsApp
AI assistant for Architect Nexus — a digital agency
specializing in AI automation, WhatsApp agents,
and intelligent business systems.

## YOUR IDENTITY
- Name: Nexus
- Agency: Architect Nexus
- You are the first point of contact for all
  clients and leads on WhatsApp

## YOUR PERSONALITY
- Sharp, confident, and professional
- Keep replies short and punchy (WhatsApp style)
- Never use long paragraphs — use bullet points
  or short lines
- Use emojis occasionally to stay warm 🤖✨
- Always make the client feel heard and valued
- Switch to Hindi or Hinglish naturally if the
  user writes in Hindi

## WHAT YOU CAN DO
- Represent Architect Nexus with confidence
- Answer questions about services and pricing
- Qualify leads with a smooth conversation flow
- Summarize emails or chats when asked
- Handle FAQs from the knowledge base
- Remind users about meetings or deadlines

## WHAT YOU CANNOT DO
- Never make up prices or promises
- Never share personal data of other clients
- If you don't know something, say:
  "Let me check with the Architect Nexus team
   and get back to you shortly! 🙏"
- Never speak negatively about competitors

## LEAD QUALIFICATION FLOW
When someone messages for the first time, run
this flow smoothly:

1. "Hey! 👋 Welcome to Architect Nexus.
    I'm Nexus, your AI assistant.
    What's your name?"

2. "Great to meet you, [Name]! 🤝
    Tell me — what kind of business do you run?"

3. "Interesting! What's your main challenge
    right now? More leads, better automation,
    or something else?"

4. "Got it. And what budget are you working
    with for this?"

5. Save all answers to the SQLite CRM database.

6. "Perfect, [Name]! 🚀 The Architect Nexus
    team will reach out to you within 24 hours.
    We build systems that work while you sleep. 😎"

## TONE EXAMPLES

User: "how much does it cost?"
Nexus: "Depends on what you need! 😊
        Architect Nexus has packages for all scales.
        What service are you looking at?"

User: "I need a WhatsApp bot"
Nexus: "You're in the right place! 🤖
        We build smart WhatsApp agents like me.
        Is this for customer support, lead gen,
        or something else?"

User: "who are you?"
Nexus: "I'm Nexus — the AI brain of
        Architect Nexus.
        I manage leads, answer questions, and
        keep things running 24/7.
        How can I help you today? ⚡"

## KNOWLEDGE BASE
Use this knowledge to answer questions accurately:

${knowledgeBase}
`.trim();

// ── Initialise the Groq client ────────────────────────────────
// The API key must be set in the .env file as GROQ_API_KEY.
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── In-memory conversation history per chat ───────────────────
// Maps chatId → array of { role, content } messages.
// This gives the AI context across a conversation.
const conversationHistory = new Map();

// Maximum number of messages to keep per conversation
// (older messages are dropped to avoid token overflow)
const MAX_CONVERSATION_HISTORY = 20;

/**
 * Get or create the message history for a given chat.
 *
 * @param {string} chatId - WhatsApp JID
 * @returns {Array} - array of message objects
 */
function getHistory(chatId) {
  if (!conversationHistory.has(chatId)) {
    conversationHistory.set(chatId, []);
  }
  return conversationHistory.get(chatId);
}

/**
 * Ask the AI a question in the context of a specific chat.
 * The system prompt + knowledge base is injected automatically.
 *
 * @param {string} chatId   - WhatsApp JID (used for conversation memory)
 * @param {string} userText - the incoming message text
 * @returns {Promise<string>} - AI reply text
 */
export async function askAI(chatId, userText) {
  try {
    // Retrieve the existing conversation history for this chat
    const history = getHistory(chatId);

    // Append the user's latest message
    history.push({ role: 'user', content: userText });

    // Keep history to the last MAX_CONVERSATION_HISTORY messages to avoid token overflow
    if (history.length > MAX_CONVERSATION_HISTORY) {
      history.splice(0, history.length - MAX_CONVERSATION_HISTORY);
    }

    // Call Groq API with the system prompt + full conversation history
    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history,
      ],
      temperature: 0.7,       // slightly creative but still factual
      max_tokens:  512,       // keep replies concise for WhatsApp
    });

    // Extract the reply text
    const reply = response.choices[0]?.message?.content?.trim()
      || "I'm having a moment 🤖 — please try again!";

    // Save the assistant's reply to history for context continuity
    history.push({ role: 'assistant', content: reply });

    return reply;
  } catch (err) {
    console.error('[AI] askAI error:', err.message);
    // Return a friendly fallback instead of crashing
    return "Oops, my brain glitched for a sec 😅 — please try again in a moment!";
  }
}

/**
 * Ask the AI to summarize a list of chat messages.
 * Used by the !summarize command.
 *
 * @param {Array<{sender: string, message: string}>} messages
 * @returns {Promise<string>} - summary text
 */
export async function summarizeChat(messages) {
  try {
    // Build a readable transcript from the messages array
    const transcript = messages
      .map(m => `${m.sender}: ${m.message}`)
      .join('\n');

    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize the following WhatsApp conversation in 5 bullet points (WhatsApp style, short and punchy):\n\n${transcript}`,
        },
      ],
      temperature: 0.5,
      max_tokens:  400,
    });

    return response.choices[0]?.message?.content?.trim()
      || 'Could not generate summary.';
  } catch (err) {
    console.error('[AI] summarizeChat error:', err.message);
    return 'Summary unavailable right now 😅';
  }
}

/**
 * Ask the AI to summarize a list of email snippets.
 * Used by the daily scheduler and !email command.
 *
 * @param {Array<{subject: string, from: string, snippet: string}>} emails
 * @returns {Promise<string>} - summary text
 */
export async function summarizeEmails(emails) {
  try {
    if (!emails || emails.length === 0) {
      return 'No unread emails to summarize.';
    }

    // Build a readable email list
    const emailText = emails
      .map((e, i) => `${i + 1}. From: ${e.from}\n   Subject: ${e.subject}\n   Preview: ${e.snippet}`)
      .join('\n\n');

    const response = await groq.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize these unread emails briefly for a WhatsApp message (use bullet points, be concise):\n\n${emailText}`,
        },
      ],
      temperature: 0.5,
      max_tokens:  400,
    });

    return response.choices[0]?.message?.content?.trim()
      || 'Could not summarize emails.';
  } catch (err) {
    console.error('[AI] summarizeEmails error:', err.message);
    return 'Email summary unavailable right now 😅';
  }
}

/**
 * Clear the conversation history for a chat.
 * Useful for resetting context when needed.
 *
 * @param {string} chatId
 */
export function clearHistory(chatId) {
  conversationHistory.delete(chatId);
}
