require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { PDFDocument, StandardFonts, rgb, PDFTextField } = require('pdf-lib');
const { Resend } = require('resend');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
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

// Seed default jobs if empty
const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs').get();
if (jobCount.c === 0) {
  const insert = db.prepare('INSERT INTO jobs (job_number, job_name) VALUES (?, ?)');
  insert.run('AJ-2025-001', 'Dartmouth Renovation');
  insert.run('AJ-2025-002', 'Fremont Commercial TI');
  insert.run('AJ-2025-003', 'Antiochian Orthodox Church');
}

// Seed admin user if empty
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
if (adminCount.c === 0) {
  db.prepare('INSERT INTO admin_users (username, password) VALUES (?, ?)').run('admin', process.env.ADMIN_PASSWORD || 'ajbuilders2025');
}

// ── Email (Resend) ────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);
const OFFICE_EMAIL = process.env.OFFICE_EMAIL || 'kathie@ajcaliforniabuilders.com';

// ── PDF Generator ─────────────────────────────────────────────
async function generateCoPdf(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]); // Letter
  const { width, height } = page.getSize();

  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Brand colors
  const darkBrown = rgb(0.078, 0.016, 0.035);   // #140409
  const bronze = rgb(0.635, 0.451, 0.224);        // #A27339
  const lightGrey = rgb(0.851, 0.847, 0.863);     // #D9D8D6
  const cream = rgb(1, 0.973, 0.941);              // #FFF8F0

  // Header background
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: darkBrown });

  // Company name
  page.drawText('A&J CALIFORNIA BUILDERS, INC.', {
    x: 40, y: height - 45,
    size: 18, font: boldFont, color: cream
  });
  page.drawText('CSLB #949668', {
    x: 40, y: height - 65,
    size: 10, font: regularFont, color: rgb(0.7, 0.7, 0.7)
  });
  page.drawText('CHANGE ORDER', {
    x: width - 180, y: height - 50,
    size: 22, font: boldFont, color: bronze
  });

  // Bronze divider
  page.drawRectangle({ x: 0, y: height - 105, width, height: 5, color: bronze });

  // Helper: draw a labeled field box
  const drawField = (label, value, x, y, w, h = 32) => {
    page.drawRectangle({ x, y, width: w, height: h, color: lightGrey });
    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
    page.drawText(label, { x: x + 6, y: y + h - 12, size: 7, font: boldFont, color: rgb(0.4, 0.4, 0.4) });
    if (value) {
      page.drawText(String(value), { x: x + 6, y: y + 8, size: 11, font: regularFont, color: darkBrown });
    }
  };

  // CO # and Date row
  drawField('CHANGE ORDER #', '', 40, height - 165, 200, 40);
  drawField('DATE', data.date || '', 260, height - 165, 140, 40);
  drawField('SUBMITTED BY', data.submitted_by || '', 420, height - 165, 152, 40);

  // Job info
  drawField('JOB NAME / NUMBER', data.job || '', 40, height - 220, 260, 40);
  drawField('GENERAL CONTRACTOR', data.gc_name || '', 320, height - 220, 252, 40);

  // Address
  drawField('JOB ADDRESS', data.address || '', 40, height - 275, 532, 40);

  // Section header
  page.drawRectangle({ x: 40, y: height - 305, width: 532, height: 22, color: darkBrown });
  page.drawText('DESCRIPTION OF EXTRA WORK', {
    x: 46, y: height - 298, size: 10, font: boldFont, color: cream
  });

  // Description box
  page.drawRectangle({ x: 40, y: height - 420, width: 532, height: 115, color: lightGrey });
  page.drawRectangle({ x: 40, y: height - 420, width: 532, height: 115, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
  if (data.description) {
    const words = data.description.split(' ');
    let line = '', lineY = height - 320, lineH = 14;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (regularFont.widthOfTextAtSize(test, 10) > 510) {
        page.drawText(line, { x: 48, y: lineY, size: 10, font: regularFont, color: darkBrown });
        line = word; lineY -= lineH;
        if (lineY < height - 415) break;
      } else { line = test; }
    }
    if (line) page.drawText(line, { x: 48, y: lineY, size: 10, font: regularFont, color: darkBrown });
  }

  // Materials section header
  page.drawRectangle({ x: 40, y: height - 450, width: 532, height: 22, color: darkBrown });
  page.drawText('MATERIALS', {
    x: 46, y: height - 443, size: 10, font: boldFont, color: cream
  });

  // Materials box
  page.drawRectangle({ x: 40, y: height - 540, width: 532, height: 90, color: lightGrey });
  page.drawRectangle({ x: 40, y: height - 540, width: 532, height: 90, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.5 });
  if (data.materials) {
    const words = data.materials.split(' ');
    let line = '', lineY = height - 462, lineH = 14;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (regularFont.widthOfTextAtSize(test, 10) > 510) {
        page.drawText(line, { x: 48, y: lineY, size: 10, font: regularFont, color: darkBrown });
        line = word; lineY -= lineH;
        if (lineY < height - 535) break;
      } else { line = test; }
    }
    if (line) page.drawText(line, { x: 48, y: lineY, size: 10, font: regularFont, color: darkBrown });
  }

  // Cost section header
  page.drawRectangle({ x: 40, y: height - 570, width: 532, height: 22, color: darkBrown });
  page.drawText('COST SUMMARY', {
    x: 46, y: height - 563, size: 10, font: boldFont, color: cream
  });

  // Cost fields
  const matCost = parseFloat(data.material_cost) || 0;
  const labCost = parseFloat(data.labor_cost) || 0;
  const total = matCost + labCost;

  drawField('MATERIAL COST', data.material_cost ? `$${matCost.toFixed(2)}` : '', 40, height - 620, 170, 40);
  drawField('LABOR COST', data.labor_cost ? `$${labCost.toFixed(2)}` : '', 220, height - 620, 170, 40);

  // Total box — highlighted
  page.drawRectangle({ x: 400, y: height - 620, width: 172, height: 40, color: bronze });
  page.drawText('TOTAL CHANGE ORDER AMOUNT', { x: 406, y: height - 592, size: 7, font: boldFont, color: cream });
  page.drawText(data.material_cost || data.labor_cost ? `$${total.toFixed(2)}` : '', {
    x: 406, y: height - 610, size: 14, font: boldFont, color: cream
  });

  // Signature section
  page.drawRectangle({ x: 40, y: height - 700, width: 532, height: 22, color: darkBrown });
  page.drawText('AUTHORIZATION', {
    x: 46, y: height - 693, size: 10, font: boldFont, color: cream
  });

  // Sig lines
  const drawSigLine = (label, x, y, w) => {
    page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
    page.drawText(label, { x, y: y - 12, size: 8, font: regularFont, color: rgb(0.5, 0.5, 0.5) });
  };

  drawSigLine('A&J Representative Signature', 40, height - 730, 240);
  drawSigLine('Date', 300, height - 730, 80);
  drawSigLine('GC / Owner Approval Signature', 40, height - 760, 240);
  drawSigLine('Date', 300, height - 760, 80);

  // Footer
  page.drawRectangle({ x: 0, y: 0, width, height: 28, color: darkBrown });
  page.drawText('A&J California Builders, Inc.  |  CSLB #949668  |  San José, CA', {
    x: 40, y: 10, size: 8, font: regularFont, color: rgb(0.6, 0.6, 0.6)
  });

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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT update job (admin)
app.put('/api/jobs/:id', requireAdmin, (req, res) => {
  const { job_number, job_name, active } = req.body;
  db.prepare('UPDATE jobs SET job_number = ?, job_name = ?, active = ? WHERE id = ?')
    .run(job_number, job_name, active ?? 1, req.params.id);
  res.json({ success: true });
});

// DELETE job (admin)
app.delete('/api/jobs/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE jobs SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// POST T&M submission
app.post('/api/submit/tm', async (req, res) => {
  const d = req.body;
  const matCost = parseFloat(d.material_cost) || 0;
  const labCost = parseFloat(d.labor_cost) || 0;
  const total = matCost + labCost;

  // Save to DB
  db.prepare('INSERT INTO submissions (type, data) VALUES (?, ?)').run('tm', JSON.stringify(d));

  const emailHtml = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #140409; padding: 24px 32px;">
        <h1 style="color: #FFF8F0; margin: 0; font-size: 20px;">A&J California Builders</h1>
        <p style="color: #A27339; margin: 4px 0 0; font-size: 13px; letter-spacing: 2px;">TIME & MATERIAL TAG</p>
      </div>
      <div style="background: #A27339; height: 4px;"></div>
      <div style="background: #FFF8F0; padding: 32px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6; width: 40%;"><strong>Date</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.date || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Job</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.job || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>General Contractor</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.gc_name || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Job Address</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.address || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Foreman</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.foreman || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Crew Count</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.crew_count || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Hours</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.hours || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Work Description</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.description || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Materials</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.materials || '—'}</td>
          </tr>
        </table>
        <div style="background: #140409; border-radius: 6px; padding: 20px; margin-top: 24px;">
          <table style="width: 100%; color: #FFF8F0;">
            <tr>
              <td style="padding: 4px 0;">Material Cost</td>
              <td style="text-align: right;">$${matCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;">Labor Cost</td>
              <td style="text-align: right;">$${labCost.toFixed(2)}</td>
            </tr>
            <tr style="border-top: 1px solid #A27339;">
              <td style="padding: 8px 0 0; font-size: 16px; font-weight: bold; color: #A27339;">TOTAL</td>
              <td style="text-align: right; font-size: 18px; font-weight: bold; color: #A27339; padding-top: 8px;">$${total.toFixed(2)}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 11px; color: #999; margin-top: 24px;">Submitted ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
      </div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'A&J Field App <field@ajcaliforniabuilders.com>',
      to: OFFICE_EMAIL,
      subject: `T&M Tag — ${d.job || 'Unassigned'} — ${d.date || new Date().toLocaleDateString()}`,
      html: emailHtml
    });

    // Confirmation to submitter if email provided
    if (d.submitter_email) {
      await resend.emails.send({
        from: 'A&J Field App <field@ajcaliforniabuilders.com>',
        to: d.submitter_email,
        subject: `✓ T&M Tag Received — ${d.job || 'Unassigned'}`,
        html: `<p style="font-family: sans-serif;">Your T&M tag for <strong>${d.job || 'Unassigned'}</strong> on ${d.date} was received by the office. Total: <strong>$${total.toFixed(2)}</strong></p>`
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Email error:', e);
    // Still save, just warn about email
    res.json({ success: true, emailWarning: 'Saved but email may not have sent. Contact office.' });
  }
});

// POST Change Order submission
app.post('/api/submit/co', async (req, res) => {
  const d = req.body;
  const matCost = parseFloat(d.material_cost) || 0;
  const labCost = parseFloat(d.labor_cost) || 0;
  const total = matCost + labCost;

  // Save to DB
  db.prepare('INSERT INTO submissions (type, data) VALUES (?, ?)').run('co', JSON.stringify(d));

  // Generate PDF
  let pdfBuffer;
  try {
    pdfBuffer = await generateCoPdf(d);
  } catch (e) {
    console.error('PDF generation error:', e);
  }

  const emailHtml = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #140409; padding: 24px 32px;">
        <h1 style="color: #FFF8F0; margin: 0; font-size: 20px;">A&J California Builders</h1>
        <p style="color: #A27339; margin: 4px 0 0; font-size: 13px; letter-spacing: 2px;">CHANGE ORDER — FIELD SUBMISSION</p>
      </div>
      <div style="background: #A27339; height: 4px;"></div>
      <div style="background: #FFF8F0; padding: 32px;">
        <p style="color: #555; font-size: 13px; border-left: 3px solid #A27339; padding-left: 12px; margin-top: 0;">
          PDF attached. Open to add CO# and obtain signatures.
        </p>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6; width: 40%;"><strong>Date</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.date || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Job</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.job || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>General Contractor</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.gc_name || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Job Address</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.address || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Submitted By</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.submitted_by || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Extra Work Description</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.description || '—'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;"><strong>Materials</strong></td>
            <td style="padding: 8px 0; border-bottom: 1px solid #D9D8D6;">${d.materials || '—'}</td>
          </tr>
        </table>
        <div style="background: #140409; border-radius: 6px; padding: 20px; margin-top: 24px;">
          <table style="width: 100%; color: #FFF8F0;">
            <tr>
              <td style="padding: 4px 0;">Material Cost</td>
              <td style="text-align: right;">$${matCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0;">Labor Cost</td>
              <td style="text-align: right;">$${labCost.toFixed(2)}</td>
            </tr>
            <tr style="border-top: 1px solid #A27339;">
              <td style="padding: 8px 0 0; font-size: 16px; font-weight: bold; color: #A27339;">TOTAL CO AMOUNT</td>
              <td style="text-align: right; font-size: 18px; font-weight: bold; color: #A27339; padding-top: 8px;">$${total.toFixed(2)}</td>
            </tr>
          </table>
        </div>
        <p style="font-size: 11px; color: #999; margin-top: 24px;">Submitted ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT</p>
      </div>
    </div>
  `;

  try {
    const emailPayload = {
      from: 'A&J Field App <field@ajcaliforniabuilders.com>',
      to: OFFICE_EMAIL,
      subject: `Change Order — ${d.job || 'Unassigned'} — ${d.date || new Date().toLocaleDateString()}`,
      html: emailHtml
    };

    if (pdfBuffer) {
      emailPayload.attachments = [{
        filename: `CO_${(d.job || 'Unassigned').replace(/[^a-z0-9]/gi, '_')}_${d.date || 'draft'}.pdf`,
        content: pdfBuffer.toString('base64')
      }];
    }

    await resend.emails.send(emailPayload);

    if (d.submitter_email) {
      await resend.emails.send({
        from: 'A&J Field App <field@ajcaliforniabuilders.com>',
        to: d.submitter_email,
        subject: `✓ Change Order Received — ${d.job || 'Unassigned'}`,
        html: `<p style="font-family: sans-serif;">Your change order for <strong>${d.job || 'Unassigned'}</strong> on ${d.date} was received by the office. Total Amount: <strong>$${total.toFixed(2)}</strong></p>`
      });
    }

    res.json({ success: true });
  } catch (e) {
    console.error('Email error:', e);
    res.json({ success: true, emailWarning: 'Saved but email may not have sent. Contact office.' });
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

// GET submissions (admin)
app.get('/api/submissions', requireAdmin, (req, res) => {
  const subs = db.prepare('SELECT * FROM submissions ORDER BY submitted_at DESC LIMIT 100').all();
  res.json(subs.map(s => ({ ...s, data: JSON.parse(s.data) })));
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => console.log(`A&J Field App server running on port ${PORT}`));
