# Empire Outreach OS

A real deployable starter outreach dashboard for Empire Company Unlimited.

## Built visibly in this project

- `server.js` — Express backend API
- `public/index.html` — visible frontend dashboard
- `package.json` — Node dependencies and start script
- `render.yaml` — Render deployment config
- `.env.example` — environment variable template
- `.gitignore` — keeps secrets and database files out of GitHub
- SQLite database using `better-sqlite3`
- Zoho SMTP sending using `nodemailer`
- CSV import
- Lead tracking
- Campaign creation
- Test email sending
- Basic campaign sending
- CSV export

## Render settings

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

## Required Render Environment Variables

```bash
ZOHO_SMTP_HOST=smtp.zoho.com
ZOHO_SMTP_PORT=465
ZOHO_SMTP_SECURE=true
ZOHO_SMTP_USER=your-zoho-email@yourdomain.co.za
ZOHO_SMTP_PASS=your-zoho-app-password
FROM_NAME=Empire Company Unlimited
DAILY_SEND_LIMIT=25
SEND_DELAY_SECONDS=180
```

## CSV format

```csv
email,first_name,company,website,offer
owner@example.com,Sarah,Example Clinic,https://example.com,Professional Email Setup
```

## Important

Do not commit `.env` or passwords to GitHub. Add secrets only inside Render Environment Variables.
