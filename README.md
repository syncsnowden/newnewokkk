# 24h HWID Key System – Vercel + Pastefy

Website + serverless API on Vercel. Pastefy is the only database.

## Deploy on Vercel (2 minutes)

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import this folder (or push to GitHub and import the repo)
3. Open **Settings → Environment Variables** and add:

| Name | Value |
|------|-------|
| `PASTEFY_API_KEY` | your Pastefy API key |
| `PASTEFY_PASTE_ID` | leave empty on first deploy |
| `HWID_SALT` | any long random string |

4. Click **Deploy**

### First deploy – get the paste ID

1. After deploy, open your site and click **Generate Key** once  
   (or hit `https://your-app.vercel.app/api/health`)
2. Go to Vercel → Project → **Logs** / **Functions**
3. Look for a line: `CREATED_PASTE_ID=xxxxxxxx`
4. Copy that ID → add it as env var `PASTEFY_PASTE_ID` → **Redeploy**

Done. Keys now persist.

## Project structure

```
├── api/
│   ├── generate.js    → POST /api/generate
│   ├── validate.js    → POST /api/validate
│   ├── status.js      → GET  /api/status?key=...
│   └── health.js      → GET  /api/health
├── lib/
│   └── db.js          → Pastefy read/write + key logic
├── public/
│   ├── index.html     → key generator website
│   ├── style.css
│   └── script.js
├── client/
│   └── key_checker.lua
├── package.json
├── vercel.json
└── README.md
```

## Luau client

Open `client/key_checker.lua` and set:

```lua
local BACKEND_URL = "https://your-app.vercel.app"
```

Then run the script. It asks for the key, grabs HWID, and validates against your Vercel API.

## API

**POST /api/generate**
```json
{ "device_id": "uuid", "fingerprint": "optional" }
```

**POST /api/validate**
```json
{ "key": "A92LmQ7xP81Z", "hwid": "device-id" }
```

**GET /api/status?key=A92LmQ7xP81Z**

**GET /api/health**
