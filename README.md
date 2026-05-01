# Nexus — WhatsApp AI Agent

> **Smart WhatsApp automation agent for Architect Nexus.**  
> Powered by Baileys · Groq (llama3-70b) · Gmail API · SQLite · node-cron

---

## 📁 Project Structure

```
nexus-agent/
├── index.js        → Entry point — starts the bot and cron jobs
├── whatsapp.js     → Baileys connection, QR scan, message handler
├── ai.js           → Groq API calls + system prompt + conversation memory
├── gmail.js        → Gmail API: read unread emails, format for WhatsApp
├── scheduler.js    → node-cron jobs (email check, daily summary)
├── db.js           → SQLite CRM: contacts, tasks, chat logs
├── knowledge.txt   → FAQ and business info used by the AI
├── .env.example    → Template for environment variables
├── package.json    → Node.js dependencies
└── README.md       → This file
```

---

## 🚀 Features

| Feature | Description |
|---|---|
| 📱 WhatsApp Listener | Connect via QR code. Replies to all DMs and group messages. |
| 🤖 AI Brain | Groq `llama3-70b` answers questions, qualifies leads, and stays in character as **Nexus**. |
| 📬 Gmail Integration | Reads unread emails every 30 min, notifies you on WhatsApp. |
| ⏰ Daily Summary | Sends a morning briefing at 8 AM with email count + pending tasks. |
| 🗄️ SQLite CRM | Auto-saves contacts, tracks lead info and pending tasks. |
| 💬 Commands | `!help`, `!summarize`, `!contacts`, `!email` |

---

## 🧰 Accounts You Need to Create (All Free)

| Service | Purpose | URL |
|---|---|---|
| **Groq** | Free AI API for llama3-70b | [console.groq.com](https://console.groq.com) |
| **Google Cloud** | Gmail API credentials | [console.cloud.google.com](https://console.cloud.google.com) |
| **Oracle Cloud** | Free VM for 24/7 hosting | [oracle.com/cloud/free](https://www.oracle.com/cloud/free) |

---

## ⚙️ Setup Instructions

### 1. Prerequisites

- **Node.js 18+** — download at [nodejs.org](https://nodejs.org)
- A **WhatsApp account** on your phone for scanning the QR code
- The three free accounts listed above

---

### 2. Clone & Install

```bash
git clone https://github.com/codewithzubair07/nexus-agent-.git
cd nexus-agent-
npm install
```

---

### 3. Set Up Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values (see each section below for how to get them).

---

### 4. Get Your Groq API Key

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up (free)
3. Click **API Keys** → **Create API Key**
4. Copy the key and paste it as `GROQ_API_KEY` in your `.env`

---

### 5. Set Up Gmail API

**Step 1 — Create a Google Cloud project:**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (e.g. "Nexus Agent")
3. Go to **APIs & Services → Library**
4. Search for **Gmail API** and click **Enable**

**Step 2 — Create OAuth2 credentials:**

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Desktop app**
4. Download the JSON file — you'll find `client_id` and `client_secret` in it
5. Set `GMAIL_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob` in your `.env`

**Step 3 — Get a refresh token:**

Run this one-time script to generate your refresh token:

```bash
node -e "
import('googleapis').then(({ google }) => {
  const oAuth2Client = new google.auth.OAuth2(
    'YOUR_CLIENT_ID',
    'YOUR_CLIENT_SECRET',
    'urn:ietf:wg:oauth:2.0:oob'
  );
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify']
  });
  console.log('Open this URL in your browser:\n' + url);
});
"
```

1. Open the URL in a browser
2. Authorize with your Google account
3. Copy the code shown and exchange it:

```bash
node -e "
import('googleapis').then(async ({ google }) => {
  const oAuth2Client = new google.auth.OAuth2(
    'YOUR_CLIENT_ID',
    'YOUR_CLIENT_SECRET',
    'urn:ietf:wg:oauth:2.0:oob'
  );
  const { tokens } = await oAuth2Client.getToken('PASTE_CODE_HERE');
  console.log('Refresh token:', tokens.refresh_token);
});
"
```

4. Paste the refresh token as `GMAIL_REFRESH_TOKEN` in your `.env`

---

### 6. Set Your Owner Phone Number

In `.env`, set your WhatsApp number (international format, no `+`):

```
OWNER_PHONE=919876543210
```

---

### 7. Start the Bot

```bash
npm start
```

On first run a QR code will appear in the terminal.  
Open **WhatsApp → Settings → Linked Devices → Link a Device** and scan it.

The bot is now live! ✅

---

## 💬 Available Commands

| Command | Description | Who can use |
|---|---|---|
| `!help` | Show all available commands | Everyone |
| `!summarize` | Summarize the last 20 messages in this chat | Everyone |
| `!contacts` | List all saved CRM contacts | Owner only |
| `!email` | Show latest 5 unread emails | Owner only |

---

## 🔄 How Auto-Reconnection Works

Baileys automatically reconnects if the connection drops.  
The bot uses `fetchLatestWaWebVersion()` on every startup to grab the current  
WhatsApp Web protocol version — this prevents the **HTTP 405** error that occurs  
when WhatsApp updates their protocol and unofficial libraries fall behind.

If you get a **"logged out"** message, delete the `auth_info/` folder and restart:

```bash
rm -rf auth_info/
npm start
```

---

## 🗄️ SQLite Database

The bot creates a `nexus.db` file automatically. Tables:

| Table | Purpose |
|---|---|
| `contacts` | Every person who messages the bot, with lead info |
| `tasks` | Pending tasks for the daily summary |
| `chat_logs` | Rolling message history for `!summarize` |

To add a task programmatically:

```js
import { addTask } from './db.js';
addTask('Follow up with client', 'Call Ali about WhatsApp bot proposal', '2026-05-15');
```

---

## ☁️ Deploying on Oracle Cloud Free VM

1. Create a free Oracle Cloud account and launch an **ARM (Ampere) VM**
2. SSH into your VM and install Node.js 18+:

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

3. Upload your project files (excluding `node_modules/` and `.env`)
4. Install dependencies: `npm install`
5. Create your `.env` file on the server
6. Use **PM2** to keep the bot running 24/7:

```bash
npm install -g pm2
pm2 start index.js --name nexus-agent
pm2 save
pm2 startup   # follow the command it prints
```

---

## 🛡️ Security Notes

- **Never commit your `.env` file** — it's already in `.gitignore`
- Rotate your API keys if they are ever exposed
- The `!contacts` and `!email` commands are restricted to `OWNER_PHONE`
- WhatsApp auth keys are stored in `auth_info/` — keep this folder private

---

## 🤝 Contributing

Built with ❤️ by [Architect Nexus](https://architectnexus.com).  
Pull requests and issues welcome!

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
