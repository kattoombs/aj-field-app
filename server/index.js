require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json());

// ── Database ──────────────────────────────────────────────────
const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'ajfield.db');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_number TEXT NOT NULL,
    job_name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
`);

// Seed admin user if empty
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
if (adminCount.c === 0) {
  db.prepare('INSERT INTO admin_users (username, password) VALUES (?, ?)').run('admin', process.env.ADMIN_PASSWORD || 'ajbuilders2025');
}

// ── Email ─────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);
const OFFICE_EMAIL = process.env.OFFICE_EMAIL || 'kathie.calbuilders@gmail.com';

// ── PDF Generator — matches A&J official CO format ────────────
async function generateCoPdf(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();

  const boldFont   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const italicFont  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const dark   = rgb(0.078, 0.016, 0.035);  // #140409
  const bronze = rgb(0.635, 0.451, 0.224);  // #A27339
  const white  = rgb(1, 1, 1);
  const black  = rgb(0, 0, 0);
  const ltgrey = rgb(0.96, 0.96, 0.96);

  const L = 40;   // left margin
  const R = 572;  // right edge
  const W = R - L; // content width = 532

  // ── TOP BRONZE BAR ─────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - 8, width: 612, height: 8, color: bronze });

  // ── HEADER ─────────────────────────────────────────────────
  // Logo circle placeholder (left)
  page.drawEllipse({ x: 80, y: height - 55, xScale: 36, yScale: 36, color: ltgrey });
  page.drawEllipse({ x: 80, y: height - 55, xScale: 36, yScale: 36, borderColor: bronze, borderWidth: 1 });
  page.drawText('CALIFORNIA', { x: 57, y: height - 51, size: 7, font: boldFont, color: dark });
  page.drawText('BUILDERS', { x: 61, y: height - 61, size: 7, font: boldFont, color: dark });

  // Company info (right-aligned)
  page.drawText('A & J CALIFORNIA BUILDERS, INC.', { x: 320, y: height - 28, size: 13, font: boldFont, color: dark });
  page.drawText('1261 Lincoln Avenue, Suite 106  |  San José, CA 95125', { x: 320, y: height - 42, size: 8, font: regularFont, color: dark });
  page.drawText('Office: 408-690-7421', { x: 320, y: height - 53, size: 8, font: regularFont, color: dark });
  page.drawText("California State Contractor's License # 949668", { x: 320, y: height - 64, size: 8, font: regularFont, color: dark });

  // ── BRONZE DIVIDER ─────────────────────────────────────────
  page.drawRectangle({ x: L, y: height - 82, width: W, height: 1.5, color: bronze });
  page.drawRectangle({ x: L, y: height - 85, width: W, height: 0.5, color: bronze });

  // ── CHANGE ORDER TITLE ─────────────────────────────────────
  const titleText = 'C H A N G E   O R D E R';
  const titleW = boldFont.widthOfTextAtSize(titleText, 18);
  page.drawText(titleText, { x: (612 - titleW) / 2, y: height - 115, size: 18, font: boldFont, color: dark });

  // ── HEADER FIELDS ROW 1: CO# | DATE | CAL PROJ# | GC PROJ# ─
  const row1Y = height - 145;
  const row1H = 30;

  // Helper: draw header cell (dark background, label + blank value)
  const headerCell = (label, value, x, w) => {
    page.drawRectangle({ x, y: row1Y, width: w, height: row1H, color: dark, borderColor: white, borderWidth: 0.5 });
    page.drawText(label, { x: x + 4, y: row1Y + row1H - 11, size: 6.5, font: boldFont, color: bronze });
    if (value) page.drawText(String(value), { x: x + 4, y: row1Y + 6, size: 9, font: regularFont, color: white });
  };

  // Value row below
  const valueCell = (value, x, w, y, h) => {
    page.drawRectangle({ x, y, width: w, height: h, color: ltgrey, borderColor: rgb(0.8,0.8,0.8), borderWidth: 0.5 });
    if (value) page.drawText(String(value), { x: x + 4, y: y + 6, size: 9, font: regularFont, color: dark });
  };

  headerCell('CHANGE ORDER NO.', '', L, 133);
  headerCell('DATE', data.date || '', L + 133, 100);
  headerCell('CAL BUILDERS PROJ #', data.job || '', L + 233, 133);
  headerCell('GEN. CONTRACTOR PROJ #', '', L + 366, 166);

  // ── HEADER FIELDS ROW 2: PROJECT | LOCATION | GEN. CONTRACTOR ─
  const row2LabelY = height - 168;
  const row2ValY   = height - 190;
  const row2H = 22;

  headerCell('PROJECT', '', L, 200);
  headerCell('LOCATION', data.address || '', L + 200, 133);
  headerCell('GEN. CONTRACTOR', data.gc_name || '', L + 333, 199);

  // ── DESCRIPTION LABEL ──────────────────────────────────────
  page.drawText('Description of extra work for this project:', {
    x: L, y: height - 210, size: 9, font: italicFont, color: dark
  });

  // ── DESCRIPTION BOX ────────────────────────────────────────
  const descBoxY = height - 390;
  const descBoxH = 175;
  page.drawRectangle({ x: L, y: descBoxY, width: W, height: descBoxH, color: rgb(0.95, 0.97, 0.99), borderColor: bronze, borderWidth: 1 });

  // Word-wrap description text
  if (data.description) {
    const words = data.description.split(' ');
    let line = '', lineY = descBoxY + descBoxH - 18, lineH = 14;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (regularFont.widthOfTextAtSize(test, 10) > W - 16) {
        if (lineY > descBoxY + 8) {
          page.drawText(line, { x: L + 8, y: lineY, size: 10, font: regularFont, color: dark });
          lineY -= lineH;
        }
        line = word;
      } else { line = test; }
    }
    if (line && lineY > descBoxY + 8) {
      page.drawText(line, { x: L + 8, y: lineY, size: 10, font: regularFont, color: dark });
    }
  }

  // ── COST TABLE ─────────────────────────────────────────────
  const matCost = parseFloat(data.material_cost) || 0;
  const labCost = parseFloat(data.labor_cost) || 0;
  const total   = matCost + labCost;

  const tableX  = 200;
  const tableW  = R - tableX;
  const tableRows = [
    { label: 'Labor:',                value: `$${labCost.toFixed(2)}`,  dark: false },
    { label: 'Material:',             value: `$${matCost.toFixed(2)}`,  dark: false },
    { label: 'P/O:',                  value: '$',                        dark: false },
    { label: 'Total Change Order:',   value: `$${total.toFixed(2)}`,    dark: true  },
    { label: 'Original Contract Amount:', value: '$',                    dark: false },
    { label: 'Previous Change Orders:',   value: '$',                    dark: false },
    { label: 'This Change Order:',    value: `$${total.toFixed(2)}`,    dark: false },
    { label: 'New Contract Amount:',  value: '$',                        dark: true  },
  ];

  const rowH   = 22;
  const valColW = 130;
  let rowY = descBoxY - 10 - (tableRows.length * rowH);

  tableRows.forEach(row => {
    const bg = row.dark ? dark : white;
    const fg = row.dark ? white : dark;
    const labelFont = row.dark ? boldFont : regularFont;

    // Label cell
    page.drawRectangle({ x: tableX, y: rowY, width: tableW - valColW, height: rowH, color: bg, borderColor: rgb(0.7,0.7,0.7), borderWidth: 0.5 });
    page.drawText(row.label, { x: tableX + 6, y: rowY + 7, size: 9, font: labelFont, color: fg });

    // Value cell
    page.drawRectangle({ x: tableX + tableW - valColW, y: rowY, width: valColW, height: rowH, color: bg, borderColor: rgb(0.7,0.7,0.7), borderWidth: 0.5 });
    // Show $ placeholder or actual value
    const displayVal = (row.value === '$' || (!data.material_cost && !data.labor_cost && row.value.startsWith('$0'))) ? '$' : row.value;
    page.drawText(displayVal, { x: tableX + tableW - valColW + 8, y: rowY + 7, size: 9, font: labelFont, color: fg });

    rowY += rowH;
  });

  // ── LEGAL TEXT ─────────────────────────────────────────────
  const legalY = rowY - (tableRows.length * rowH) - 20;
  // recalculate: rowY is now at top of table after loop
  const tableTopY = rowY; // rowY ended up at top
  const legalTextY = descBoxY - (tableRows.length * rowH) - 30;

  page.drawText('In accordance with the subcontract agreement on the above-mentioned project, please add/deduct work requested.', {
    x: L, y: legalTextY, size: 7.5, font: italicFont, color: dark
  });

  // ── SIGNATURE BLOCKS ───────────────────────────────────────
  const sigY = legalTextY - 20;
  const sigW = (W / 2) - 6;

  // Left: A&J
  page.drawRectangle({ x: L, y: sigY, width: sigW, height: 16, color: dark });
  page.drawText('A & J CALIFORNIA BUILDERS, INC. — AUTHORIZED SIGNATURE', { x: L + 4, y: sigY + 4, size: 6.5, font: boldFont, color: bronze });

  // Right: GC
  page.drawRectangle({ x: L + sigW + 12, y: sigY, width: sigW, height: 16, color: dark });
  page.drawText('ACCEPTED BY — GENERAL CONTRACTOR / OWNER', { x: L + sigW + 16, y: sigY + 4, size: 6.5, font: boldFont, color: bronze });

  // Sig lines
  const drawLine = (x1, y1, x2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y1 }, thickness: 0.5, color: rgb(0.5,0.5,0.5) });
  const drawLabel = (text, x, y) => page.drawText(text, { x, y, size: 7, font: regularFont, color: rgb(0.5,0.5,0.5) });

  // Left sig block
  drawLine(L, sigY - 18, L + sigW);
  drawLabel('Signature', L, sigY - 28);
  drawLine(L, sigY - 44, L + sigW);
  drawLabel('Printed Name', L, sigY - 54);
  drawLine(L, sigY - 68, L + (sigW * 0.6));
  drawLine(L + (sigW * 0.65), sigY - 68, L + sigW);
  drawLabel('Title', L, sigY - 78);
  drawLabel('Date', L + (sigW * 0.65), sigY - 78);

  // Right sig block
  const rx = L + sigW + 12;
  drawLine(rx, sigY - 18, rx + sigW);
  drawLabel('Signature', rx, sigY - 28);
  drawLine(rx, sigY - 44, rx + sigW);
  drawLabel('Printed Name', rx, sigY - 54);
  drawLine(rx, sigY - 68, rx + (sigW * 0.6));
  drawLine(rx + (sigW * 0.65), sigY - 68, rx + sigW);
  drawLabel('Title', rx, sigY - 78);
  drawLabel('Date', rx + (sigW * 0.65), sigY - 78);

  // ── BOTTOM FOOTER ──────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 22, color: bronze });
  const footerText = "A & J California Builders, Inc.  |  License # 949668  |  1261 Lincoln Ave, Suite 106, San José, CA 95125  |  408-690-7421";
  const footerW = regularFont.widthOfTextAtSize(footerText, 7);
  page.drawText(footerText, { x: (612 - footerW) / 2, y: 7, size: 7, font: regularFont, color: white });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ── Routes ────────────────────────────────────────────────────

// GET all active jobs
app.get('/api/jobs', (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs WHERE active = 1 ORDER BY job_number').all();
  res.json(jobs);
});

// POST new job (admin)
app.post('/api/jobs', requireAdmin, (req, res) => {
  const { job_number, job_name } = req.body;
  if (!job_number || !job_name) return res.status(400).json({ error: 'job_number and job_name required' });
  try {
    const result = db.prepare('INSERT INTO jobs (job_number, job_name) VALUES (?, ?)').run(job_number, job_name);
    res.json({ id: result.lastInsertRowid, job_number, job_name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT update job (admin)
app.put('/api/jobs/:id', requireAdmin, (req, res) => {
  const { job_number, job_name, active } = req.body;
  db.prepare('UPDATE jobs SET job_number = ?, job_name = ?, active = ? WHERE id = ?').run(job_number, job_name, active ?? 1, req.params.id);
  res.json({ success: true });
});

// DELETE job (admin)
app.delete('/api/jobs/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE jobs SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── Email helpers ─────────────────────────────────────────────
function emailHeader(title) {
  return `<div style="font-family: Georgia, serif; max-width: 620px; margin: 0 auto;">
    <div style="background: #140409; padding: 22px 32px 18px;">
      <p style="color: #A27339; margin: 0; font-size: 11px; letter-spacing: 2px; text-transform: uppercase;">A&amp;J California Builders, Inc.</p>
      <h1 style="color: #FFF8F0; margin: 6px 0 0; font-size: 20px; font-family: Georgia, serif;">${title}</h1>
    </div>
    <div style="background: #A27339; height: 3px;"></div>
    <div style="background: #FFF8F0; padding: 28px 32px;">`;
}

function emailRow(label, value) {
  return `<tr>
    <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6; width: 42%; font-size: 13px; font-weight: 600; color: #555;">${label}</td>
    <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6; font-size: 13px; color: #140409;">${value || '—'}</td>
  </tr>`;
}

function emailCostBox(mat, lab, total, label) {
  return `<div style="background: #140409; border-radius: 6px; padding: 18px 20px; margin-top: 20px;">
    <table style="width: 100%; color: #FFF8F0; font-size: 13px;">
      <tr><td>Material Cost</td><td style="text-align:right;">$${mat}</td></tr>
      <tr><td>Labor Cost</td><td style="text-align:right;">$${lab}</td></tr>
      <tr style="border-top: 1px solid #A27339;">
        <td style="padding-top: 10px; font-size: 15px; font-weight: bold; color: #A27339;">${label}</td>
        <td style="text-align:right; padding-top: 10px; font-size: 18px; font-weight: bold; color: #A27339;">$${total}</td>
      </tr>
    </table>
  </div>`;
}

function emailFooter(note) {
  return `${note ? `<p style="font-size: 12px; color: #888; margin-top: 20px; border-left: 3px solid #A27339; padding-left: 10px;">${note}</p>` : ''}
    <p style="font-size: 10px; color: #bbb; margin-top: 24px;">Submitted ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
    </div></div>`;
}

// ── POST T&M submission ───────────────────────────────────────
app.post('/api/submit/tm', async (req, res) => {
  const d = req.body;
  const mat   = parseFloat(d.material_cost) || 0;
  const lab   = parseFloat(d.labor_cost)    || 0;
  const total = mat + lab;

  db.prepare('INSERT INTO submissions (type, data) VALUES (?, ?)').run('tm', JSON.stringify(d));

  const html = emailHeader('Time &amp; Material Tag')
    + `<table style="width:100%; border-collapse:collapse;">`
    + emailRow('Date', d.date)
    + emailRow('Job', d.job)
    + emailRow('General Contractor', d.gc_name)
    + emailRow('Job Address', d.address)
    + emailRow('Foreman', d.foreman)
    + emailRow('Crew Count', d.crew_count)
    + emailRow('Hours', d.hours)
    + emailRow('Work Description', d.description)
    + emailRow('Materials', d.materials)
    + `</table>`
    + emailCostBox(mat.toFixed(2), lab.toFixed(2), total.toFixed(2), 'TOTAL T&amp;M AMOUNT')
    + emailFooter();

  try {
    await resend.emails.send({
      from: 'AJ Field App <onboarding@resend.dev>',
      to: OFFICE_EMAIL,
      subject: `T&M Tag — ${d.job || 'Unassigned'} — ${d.date || new Date().toLocaleDateString()}`,
      html
    });
    if (d.submitter_email) {
      await resend.emails.send({
        from: 'AJ Field App <onboarding@resend.dev>',
        to: d.submitter_email,
        subject: `✓ T&M Tag Received — ${d.job || 'Unassigned'}`,
        html: `<p style="font-family:sans-serif;">Your T&M tag for <strong>${d.job || 'Unassigned'}</strong> on ${d.date} was received. Total: <strong>$${total.toFixed(2)}</strong></p>`
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Email error:', e);
    res.json({ success: true, emailWarning: 'Saved but email may not have sent.' });
  }
});

// ── POST Change Order submission ──────────────────────────────
app.post('/api/submit/co', async (req, res) => {
  const d = req.body;
  const mat   = parseFloat(d.material_cost) || 0;
  const lab   = parseFloat(d.labor_cost)    || 0;
  const total = mat + lab;

  db.prepare('INSERT INTO submissions (type, data) VALUES (?, ?)').run('co', JSON.stringify(d));

  let pdfBuffer;
  try { pdfBuffer = await generateCoPdf(d); } catch (e) { console.error('PDF error:', e); }

  const html = emailHeader('Change Order — Field Submission')
    + `<p style="font-size:12px; color:#666; border-left:3px solid #A27339; padding-left:10px; margin-bottom:20px;">PDF attached — open to add CO#, GC Project#, contract amounts, and obtain signatures.</p>`
    + `<table style="width:100%; border-collapse:collapse;">`
    + emailRow('Date', d.date)
    + emailRow('Submitted By', d.submitted_by)
    + emailRow('Job', d.job)
    + emailRow('General Contractor', d.gc_name)
    + emailRow('Job Address', d.address)
    + emailRow('Description of Extra Work', d.description)
    + emailRow('Materials', d.materials)
    + `</table>`
    + emailCostBox(mat.toFixed(2), lab.toFixed(2), total.toFixed(2), 'TOTAL CHANGE ORDER AMOUNT')
    + emailFooter();

  try {
    const payload = {
      from: 'AJ Field App <onboarding@resend.dev>',
      to: OFFICE_EMAIL,
      subject: `Change Order — ${d.job || 'Unassigned'} — ${d.date || new Date().toLocaleDateString()}`,
      html
    };
    if (pdfBuffer) {
      payload.attachments = [{
        filename: `CO_${(d.job || 'Unassigned').replace(/[^a-z0-9]/gi, '_')}_${d.date || 'draft'}.pdf`,
        content: pdfBuffer.toString('base64')
      }];
    }
    await resend.emails.send(payload);

    if (d.submitter_email) {
      await resend.emails.send({
        from: 'AJ Field App <onboarding@resend.dev>',
        to: d.submitter_email,
        subject: `✓ Change Order Received — ${d.job || 'Unassigned'}`,
        html: `<p style="font-family:sans-serif;">Your change order for <strong>${d.job || 'Unassigned'}</strong> on ${d.date} was received. Total: <strong>$${total.toFixed(2)}</strong></p>`
      });
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Email error:', e);
    res.json({ success: true, emailWarning: 'Saved but email may not have sent.' });
  }
});

// ── Admin Auth ────────────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ? AND password = ?').get(username, password);
  if (user) {
    res.json({ success: true, token: Buffer.from(`${username}:${password}`).toString('base64') });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const decoded = Buffer.from(auth.slice(7), 'base64').toString();
  const [username, password] = decoded.split(':');
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ? AND password = ?').get(username, password);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/submissions', requireAdmin, (req, res) => {
  const subs = db.prepare('SELECT * FROM submissions ORDER BY submitted_at DESC LIMIT 100').all();
  res.json(subs.map(s => ({ ...s, data: JSON.parse(s.data) })));
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`A&J Field App server running on port ${PORT}`));
