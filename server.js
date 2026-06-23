require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const multer = require('multer');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');
const { parse } = require('@fast-csv/parse');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'empire-outreach.sqlite'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      first_name TEXT DEFAULT '',
      company TEXT DEFAULT '',
      website TEXT DEFAULT '',
      offer TEXT DEFAULT 'Professional Email Setup',
      status TEXT DEFAULT 'new',
      last_subject TEXT DEFAULT '',
      last_message TEXT DEFAULT '',
      sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      offer TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      campaign_id INTEGER,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
initDb();

function personalize(text, lead) {
  const first = lead.first_name || 'there';
  return String(text || '')
    .replaceAll('{{first_name}}', first)
    .replaceAll('{{company}}', lead.company || 'your business')
    .replaceAll('{{website}}', lead.website || '')
    .replaceAll('{{offer}}', lead.offer || 'our service');
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getTransporter() {
  const user = process.env.ZOHO_SMTP_USER;
  const pass = process.env.ZOHO_SMTP_PASS;
  if (!user || !pass) {
    throw new Error('Zoho SMTP is not configured. Add ZOHO_SMTP_USER and ZOHO_SMTP_PASS in Render environment variables.');
  }
  return nodemailer.createTransport({
    host: process.env.ZOHO_SMTP_HOST || 'smtp.zoho.com',
    port: Number(process.env.ZOHO_SMTP_PORT || 465),
    secure: String(process.env.ZOHO_SMTP_SECURE || 'true') === 'true',
    auth: { user, pass }
  });
}

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'Empire Outreach OS', time: new Date().toISOString() });
});

app.get('/api/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
  const sent = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE status='sent'").get().c;
  const failed = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE status='failed'").get().c;
  const newLeads = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE status='new'").get().c;
  const campaigns = db.prepare('SELECT COUNT(*) AS c FROM campaigns').get().c;
  res.json({ total, sent, failed, new: newLeads, campaigns });
});

app.get('/api/leads', (req, res) => {
  const leads = db.prepare('SELECT * FROM leads ORDER BY id DESC LIMIT 500').all();
  res.json(leads);
});

app.post('/api/leads', (req, res) => {
  const rawLeads = Array.isArray(req.body.leads) ? req.body.leads : [];
  const insert = db.prepare('INSERT OR IGNORE INTO leads (email, first_name, company, website, offer) VALUES (?, ?, ?, ?, ?)');
  let added = 0;
  for (const lead of rawLeads) {
    const email = String(lead.email || '').trim().toLowerCase();
    if (!validEmail(email)) continue;
    const result = insert.run(email, lead.first_name || '', lead.company || '', lead.website || '', lead.offer || 'Professional Email Setup');
    if (result.changes) added++;
  }
  res.json({ ok: true, added });
});

app.post('/api/import-csv', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded.' });
  const rows = [];
  parse.parseString(req.file.buffer.toString('utf8'), { headers: true, ignoreEmpty: true })
    .on('error', error => res.status(400).json({ error: error.message }))
    .on('data', row => rows.push(row))
    .on('end', () => {
      const insert = db.prepare('INSERT OR IGNORE INTO leads (email, first_name, company, website, offer) VALUES (?, ?, ?, ?, ?)');
      let added = 0;
      for (const row of rows) {
        const email = String(row.email || row.Email || '').trim().toLowerCase();
        if (!validEmail(email)) continue;
        const result = insert.run(email, row.first_name || row.name || '', row.company || '', row.website || '', row.offer || 'Professional Email Setup');
        if (result.changes) added++;
      }
      res.json({ ok: true, added });
    });
});

app.get('/api/campaigns', (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
  res.json(campaigns);
});

app.post('/api/campaigns', (req, res) => {
  const { name, offer, subject, body } = req.body;
  if (!name || !subject || !body) return res.status(400).json({ error: 'Campaign name, subject and body are required.' });
  const result = db.prepare('INSERT INTO campaigns (name, offer, subject, body) VALUES (?, ?, ?, ?)')
    .run(name, offer || 'Professional Email Setup', subject, body);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.post('/api/generate', (req, res) => {
  const offer = req.body.offer || 'Professional Email Setup';
  const subject = offer.toLowerCase().includes('email') ? 'Quick professional email question' : `Quick question about ${offer}`;
  const body = `Hi {{first_name}},\n\nQuick question. If two businesses offered the exact same service, but one used a Gmail address and the other used a professional company email, which one would look more trusted before the client even replied?\n\nThat tiny detail can change how people judge {{company}}.\n\nEmpire Company Unlimited helps businesses set up professional domain email systems so the first impression matches the standard of the business.\n\nWould you like me to show you what this could look like for {{company}}?\n\nKind regards,\nEmpire Company Unlimited`;
  res.json({ subject, body });
});

app.post('/api/send-test', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!validEmail(to)) return res.status(400).json({ error: 'Valid recipient email required.' });
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME || 'Empire Company Unlimited'}" <${process.env.ZOHO_SMTP_USER}>`,
      to,
      subject: subject || 'Empire Outreach OS test',
      text: body || 'This is a test from Empire Outreach OS.'
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/start-campaign/:id', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id=?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const limit = Math.max(1, Number(process.env.DAILY_SEND_LIMIT || 25));
  const leads = db.prepare("SELECT * FROM leads WHERE status='new' LIMIT ?").all(limit);
  if (!leads.length) return res.json({ ok: true, sent: 0, message: 'No new leads to send.' });

  let transporter;
  try { transporter = getTransporter(); } catch (error) { return res.status(500).json({ error: error.message }); }

  let sent = 0;
  let failed = 0;
  for (const lead of leads) {
    const subject = personalize(campaign.subject, lead);
    const text = personalize(campaign.body, lead);
    try {
      await transporter.sendMail({
        from: `"${process.env.FROM_NAME || 'Empire Company Unlimited'}" <${process.env.ZOHO_SMTP_USER}>`,
        to: lead.email,
        subject,
        text
      });
      db.prepare("UPDATE leads SET status='sent', last_subject=?, last_message=?, sent_at=CURRENT_TIMESTAMP WHERE id=?").run(subject, text, lead.id);
      db.prepare('INSERT INTO send_log (lead_id, campaign_id, email, status) VALUES (?, ?, ?, ?)').run(lead.id, campaign.id, lead.email, 'sent');
      sent++;
    } catch (error) {
      db.prepare("UPDATE leads SET status='failed' WHERE id=?").run(lead.id);
      db.prepare('INSERT INTO send_log (lead_id, campaign_id, email, status, error) VALUES (?, ?, ?, ?, ?)').run(lead.id, campaign.id, lead.email, 'failed', error.message);
      failed++;
    }
  }
  db.prepare("UPDATE campaigns SET status='sent' WHERE id=?").run(campaign.id);
  res.json({ ok: true, sent, failed });
});

app.get('/api/export.csv', (req, res) => {
  const leads = db.prepare('SELECT email, first_name, company, website, offer, status, sent_at FROM leads ORDER BY id DESC').all();
  const header = 'email,first_name,company,website,offer,status,sent_at\n';
  const lines = leads.map(l => [l.email, l.first_name, l.company, l.website, l.offer, l.status, l.sent_at || ''].map(v => `"${String(v || '').replaceAll('"', '""')}"`).join(','));
  res.header('Content-Type', 'text/csv');
  res.attachment('empire-outreach-leads.csv');
  res.send(header + lines.join('\n'));
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Empire Outreach OS running on port ${PORT}`));
