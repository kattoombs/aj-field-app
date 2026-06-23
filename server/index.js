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
  CREATE TABLE IF NOT EXISTS gcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    active INTEGER DEFAULT 1
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

// Seed GCs if empty
const gcCount = db.prepare('SELECT COUNT(*) as c FROM gcs').get();
if (gcCount.c === 0) {
  const insertGC = db.prepare('INSERT INTO gcs (name, address) VALUES (?, ?)');
  const gcs = [
    ['A&J California Builders, Inc.', '1261 Lincoln Ave STE106, San Jose, CA 95125'],
    ['Arco Murray', ''],
    ['Bay Area Builders, Inc.', '3360 De La Cruz Blvd., Santa Clara, CA 95054'],
    ['Brooke Shaw Builder', '2324 Shibley Ave., San Jose, CA 95125'],
    ['Bruce E. Boyle Construction, Inc.', '191 Lemoore Drive, San Carlos, CA 94070'],
    ['BSM Construction, Inc.', '2575 Stanwell Dr. Second Floor, Concord, CA 94520'],
    ['Casaccia Construction', '100 Mary Way, Los Gatos, CA 95032'],
    ['Center-Line Construction, Inc.', '918 Washington St., San Carlos, CA 94070'],
    ['Challenger School', '711 E. Gish Rd., San Jose, CA 95112'],
    ['Citadel, Inc.', '75 E. Santa Clara St., San Jose, CA'],
    ['COBE Construction', '498 Salmar Ave., Campbell, CA 95008'],
    ['Cody Vermette Group, Inc.', '1305 Elmer St., Belmont, CA 94002'],
    ['Constructive Solutions, Inc.', '2041 Pioneer Ct. Ste. 208, San Mateo, CA 94403'],
    ['Decker Engineering & Construction', '1261 Lincoln Ave. Ste. 220, San Jose, CA 95125'],
    ['First Finish, LLC', '6240 Old Dobbin Lane STE 190, Columbia, MD 21045'],
    ['GKW Constructors, Inc.', ''],
    ['Innovative Project Solutions Inc.', '50 California St. 15th Floor, San Francisco, CA 94111'],
    ['J.M. Stitt Construction, Inc.', '3165 Palisades Dr., Corona, CA 92878'],
    ['John Donovan', '23005 Del Monte Way, Los Gatos, CA 95030'],
    ['John Panos', 'P.O. BOX 510, San Martin, CA 95046'],
    ['Kenson Adventures', ''],
    ['Kent Construction', '8505 Church St. Ste. 12, Gilroy, CA 95020'],
    ['La Rinconada Country Club', '14595 Clearview Drive, Los Gatos, CA 95032'],
    ['Lusardi Construction Company', '1570 Linda Vista Dr., San Marcos, CA 92078'],
    ['LWG Construction, Inc.', '280 Digital Dr., Morgan Hill, CA 95037'],
    ['Mike McCloud Construction', '1073 Thornton Way, San Jose, CA 95128'],
    ['Nikki Chan & Mimi Dao', '1093 Normandy Drive, Campbell, CA 95008'],
    ['OPI Commercial Builders, Inc.', '1202 Lincoln Avenue, Ste 10, San Jose, CA 95125'],
    ['Pacific General Construction', '1150 Cadillac Court, Milpitas, CA 95035'],
    ['RL Brackett Construction', '3400 De La Cruz Blvd. Unit M, Santa Clara, CA 95054'],
    ['S.B.C.C.', ''],
    ['Scott Daniels', '1540 Miramonte, Los Altos, CA 94024'],
    ['Seegert Construction', '3098 Industrial Blvd, Sacramento, CA 95691'],
    ['Snipes Construction Inc.', '4810 Golden Foothill Pkwy #8, El Dorado Hills, CA 95762'],
    ['South Bay Construction', '1711 Dell Avenue, Campbell, CA 95008'],
    ['Steed Construction, Inc.', '1250 E. Iron Eagle Dr. Ste. 200, Eagle, ID 83616'],
    ['Steve Casaccia', '100 Mary Way, Los Gatos, CA 95032'],
    ['Suner Corp', ''],
    ['The James Group', '7691 Hanna Street, Gilroy, CA 95020'],
    ['TICO Construction, Inc.', '1585 Terminal Ave., San Jose, CA 95112'],
    ['Valley Design & Construction, Inc.', '1180 Coleman Ave., San Jose, CA 95110'],
    ['WDS Construction', '100 Tower Dr., Beaver Dam, WI 53916'],
    ['West Broadway Building Co.', '4590 MacArthur Blvd. Ste. 500, Newport Beach, CA 92660'],
  ];
  gcs.forEach(([name, address]) => insertGC.run(name, address));
}

// Seed admin user if empty
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
if (adminCount.c === 0) {
  db.prepare('INSERT INTO admin_users (username, password) VALUES (?, ?)').run('admin', process.env.ADMIN_PASSWORD || 'ajbuilders2025');
}

// ── Email ─────────────────────────────────────────────────────
const resend = new Resend(process.env.RESEND_API_KEY);
const OFFICE_EMAIL = process.env.OFFICE_EMAIL || 'kathie.calbuilders@gmail.com';
const OFFICE_EMAILS = OFFICE_EMAIL.split(',').map(e => e.trim());

// ── PDF Generator ─────────────────────────────────────────────
async function generateCoPdf(data) {
  const pdfDoc = await PDFDocument.create();
  const page   = pdfDoc.addPage([612, 792]);
  const W612   = 612, H = 792;

  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const reg     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const italic  = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const boldIta = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const gold      = rgb(0.722, 0.533, 0.165);
  const goldLight = rgb(0.831, 0.659, 0.290);
  const charcoal  = rgb(0.110, 0.110, 0.110);
  const midGray   = rgb(0.333, 0.333, 0.333);
  const goldTint  = rgb(0.980, 0.965, 0.933);
  const borderC   = rgb(0.173, 0.173, 0.173);
  const white     = rgb(1, 1, 1);

  const inch = 72;
  const mL   = 0.65 * inch;
  const mR   = W612 - 0.65 * inch;
  const fW   = mR - mL;

  const drawRight = (text, rightX, y, size, font, color) => {
    const tw = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: rightX - tw, y, size, font, color });
  };

  page.drawRectangle({ x: 0, y: H - 0.18 * inch, width: W612, height: 0.18 * inch, color: gold });

  const headerTop    = H - 0.35 * inch;
  const headerBottom = H - 1.45 * inch;
  const infoY = headerTop - 0.15 * inch;
  drawRight('A & J CALIFORNIA BUILDERS, INC.', mR, infoY, 12, bold, charcoal);
  drawRight('1261 Lincoln Avenue, Suite 106  |  San Jose, CA 95125', mR, infoY - 0.18 * inch, 8.5, reg, midGray);
  drawRight('Office: 408-690-7421', mR, infoY - 0.33 * inch, 8.5, reg, midGray);
  drawRight("California State Contractor's License # 949668", mR, infoY - 0.48 * inch, 8.5, reg, midGray);

  const divY = headerBottom - 0.05 * inch;
  page.drawLine({ start: { x: mL, y: divY }, end: { x: mR, y: divY }, thickness: 2.5, color: gold });

  const titleY   = divY - 0.38 * inch;
  const titleTxt = 'C H A N G E   O R D E R';
  const titleW2  = bold.widthOfTextAtSize(titleTxt, 17);
  page.drawText(titleTxt, { x: (W612 - titleW2) / 2, y: titleY, size: 17, font: bold, color: charcoal });
  page.drawLine({ start: { x: W612 / 2 - 1.5 * inch, y: titleY - 0.1 * inch }, end: { x: W612 / 2 + 1.5 * inch, y: titleY - 0.1 * inch }, thickness: 1, color: gold });

  const gridTop = titleY - 0.28 * inch;
  const rowH    = 0.34 * inch;
  const colW    = fW / 4;
  const lbFrac  = 0.42;

  const drawCell = (x, y, w, h, label) => {
    page.drawRectangle({ x, y, width: w, height: h, color: white, borderColor: borderC, borderWidth: 0.6 });
    const lbH = h * lbFrac;
    page.drawRectangle({ x, y: y + h - lbH, width: w, height: lbH, color: charcoal });
    page.drawText(label, { x: x + 4, y: y + h - lbH + 3, size: 6, font: bold, color: goldLight });
    page.drawRectangle({ x, y, width: w, height: h - lbH, color: goldTint });
  };

  const drawCellVal = (value, x, y, h, maxW) => {
    if (!value) return;
    let txt = String(value);
    if (maxW) {
      while (txt.length > 1 && reg.widthOfTextAtSize(txt, 9) > maxW - 8) txt = txt.slice(0, -1);
      if (txt.length < String(value).length) txt = txt.slice(0, -1) + '...';
    }
    page.drawText(txt, { x: x + 4, y: y + 6, size: 9, font: reg, color: charcoal });
  };

  const dashIdx = (data.job || '').indexOf(' — ');
  const jobNum  = dashIdx >= 0 ? (data.job || '').slice(0, dashIdx).trim() : (data.job || '').split(/\s+/)[0];
  const jobName = dashIdx >= 0 ? (data.job || '').slice(dashIdx + 3).trim() : (data.job || '');

  const r1y = gridTop - rowH;
  const r1L = ['CHANGE ORDER NO.', 'DATE', 'CAL BUILDERS PROJ #', 'GEN. CONTRACTOR PROJ #'];
  const r1V = ['', data.date || '', jobNum, ''];
  for (let i = 0; i < 4; i++) {
    const cx = mL + i * colW;
    drawCell(cx, r1y, colW, rowH, r1L[i]);
    drawCellVal(r1V[i], cx, r1y, rowH, colW);
  }

  const r2y = r1y - rowH;
  drawCell(mL,             r2y, colW,     rowH, 'PROJECT');
  drawCell(mL + colW,      r2y, colW,     rowH, 'GEN. CONTRACTOR');
  drawCell(mL + colW * 2,  r2y, colW * 2, rowH, 'LOCATION');
  drawCellVal(jobName,            mL,            r2y, rowH, colW);
  drawCellVal(data.gc_name || '', mL + colW,     r2y, rowH, colW);
  drawCellVal(data.address || '', mL + colW * 2, r2y, rowH, colW * 2);

  const descLabelY = r2y - 0.32 * inch;
  page.drawText('Description of extra work for this project:', { x: mL, y: descLabelY, size: 8.5, font: boldIta, color: charcoal });

  const descH = 2.4 * inch;
  const descY = descLabelY - descH - 0.08 * inch;
  page.drawRectangle({ x: mL, y: descY, width: fW, height: descH, color: goldTint, borderColor: borderC, borderWidth: 0.7 });
  page.drawRectangle({ x: mL, y: descY, width: 3, height: descH, color: gold });

  // Fully editable description field pre-loaded with Aaron's text
  const descField = pdfDoc.getForm().createTextField("description");
  descField.setText(data.description || "");
  descField.enableMultiline();
  descField.addToPage(page, {
    x: mL + 4, y: descY + 2,
    width: fW - 8, height: descH - 4,
    borderWidth: 0,
    backgroundColor: goldTint,
    textColor: charcoal,
    font: reg,
    fontSize: 9
  });

  const form = pdfDoc.getForm();
  const addField = (name, x, y, w, h, defaultVal = '') => {
    const field = form.createTextField(name);
    field.setText(defaultVal);
    field.addToPage(page, { x: x + 2, y: y + 2, width: w - 4, height: h - 4, borderWidth: 0, backgroundColor: goldTint, textColor: charcoal, font: reg, fontSize: 9 });
  };

  const lbH_r1 = rowH * lbFrac;
  const valH   = rowH - lbH_r1;
  addField('change_order_no', mL,            r1y, colW, valH + 2);
  addField('gc_proj_no',      mL + colW * 3, r1y, colW, valH + 2);

  const matCost = parseFloat(data.material_cost) || 0;
  const labCost = parseFloat(data.labor_cost)    || 0;
  const total   = matCost + labCost;

  const labelW  = 3.1 * inch;
  const amtW    = 1.75 * inch;
  const tableX  = mL + (fW - labelW - amtW) / 2;
  const finRowH = 0.27 * inch;
  const finTop  = descY - 0.28 * inch;

  const finRows = [
    { label: 'Labor:',                    val: labCost > 0 ? labCost.toFixed(2) : '', fillable: false, total: false },
    { label: 'Material:',                 val: matCost > 0 ? matCost.toFixed(2) : '', fillable: false, total: false },
    { label: 'P/O:',                      val: '', fillable: true,  total: false, fieldName: 'po' },
    { label: 'Total Change Order:',       val: '', fillable: true,  total: true,  fieldName: 'total_co' },
    { label: 'Original Contract Amount:', val: '', fillable: true,  total: false, fieldName: 'original_contract' },
    { label: 'Previous Change Orders:',   val: '', fillable: true,  total: false, fieldName: 'previous_cos' },
    { label: 'This Change Order:',        val: '', fillable: true,  total: false, fieldName: 'this_co' },
    { label: 'New Contract Amount:',      val: '', fillable: true,  total: true,  fieldName: 'new_contract' },
  ];

  finRows.forEach((row, i) => {
    const ry  = finTop - (i + 1) * finRowH;
    const bgL = row.total ? charcoal : goldTint;
    const fgL = row.total ? white    : charcoal;
    const fnt = row.total ? bold     : reg;
    page.drawRectangle({ x: tableX, y: ry, width: labelW, height: finRowH, color: bgL, borderColor: borderC, borderWidth: 0.6 });
    page.drawText(row.label, { x: tableX + 8, y: ry + 7, size: 9, font: fnt, color: fgL });
    page.drawRectangle({ x: tableX + labelW, y: ry, width: amtW, height: finRowH, color: white, borderColor: borderC, borderWidth: 0.6 });
    page.drawText('$', { x: tableX + labelW + 6, y: ry + 7, size: 9, font: reg, color: midGray });
    if (row.fillable) {
      const ff = form.createTextField(row.fieldName);
      ff.setText('');
      ff.addToPage(page, { x: tableX + labelW + 18, y: ry + 2, width: amtW - 22, height: finRowH - 4, borderWidth: 0, backgroundColor: white, textColor: charcoal, font: reg, fontSize: 9 });
    } else if (row.val) {
      page.drawText(row.val, { x: tableX + labelW + 20, y: ry + 7, size: 9, font: reg, color: charcoal });
    }
  });

  const authY   = finTop - finRows.length * finRowH - 0.3 * inch;
  const authTxt = 'In accordance with the subcontract agreement on the above-mentioned project, please add/deduct work requested.';
  const authW   = italic.widthOfTextAtSize(authTxt, 8);
  page.drawText(authTxt, { x: (W612 - authW) / 2, y: authY, size: 8, font: italic, color: midGray });

  const sigTop = authY - 0.4 * inch;
  const sigW   = (fW - 0.4 * inch) / 2;
  const leftX  = mL;
  const rightX = mL + sigW + 0.4 * inch;

  const sigBlock = (x, y, titleStr, prefix) => {
    page.drawRectangle({ x, y, width: sigW, height: 0.25 * inch, color: charcoal });
    page.drawText(titleStr, { x: x + 5, y: y + 7, size: 6.5, font: bold, color: goldLight });
    const sl = (lx, ly, lx2) => page.drawLine({ start: { x: lx, y: ly }, end: { x: lx2, y: ly }, thickness: 0.7, color: borderC });
    const lb = (txt, lx, ly)  => page.drawText(txt, { x: lx, y: ly, size: 7, font: reg, color: midGray });
    const sigLineY = y - 0.5 * inch;
    sl(x, sigLineY, x + sigW); lb('Signature', x, sigLineY - 0.12 * inch);
    const nameY = sigLineY - 0.48 * inch;
    sl(x, nameY, x + sigW); lb('Printed Name', x, nameY - 0.12 * inch);
    const nameField = form.createTextField(`${prefix}_printed_name`);
    nameField.setText('');
    nameField.addToPage(page, { x: x + 2, y: nameY + 1, width: sigW - 4, height: 0.22 * inch, borderWidth: 0, backgroundColor: white, textColor: charcoal, font: reg, fontSize: 9 });
    const tdY = nameY - 0.58 * inch;
    sl(x, tdY, x + sigW * 0.58); sl(x + sigW * 0.65, tdY, x + sigW);
    lb('Title', x, tdY - 0.12 * inch); lb('Date', x + sigW * 0.65, tdY - 0.12 * inch);
    const titleField = form.createTextField(`${prefix}_title`);
    titleField.setText('');
    titleField.addToPage(page, { x: x + 2, y: tdY + 1, width: sigW * 0.58 - 4, height: 0.22 * inch, borderWidth: 0, backgroundColor: white, textColor: charcoal, font: reg, fontSize: 9 });
    const dateField = form.createTextField(`${prefix}_date`);
    dateField.setText('');
    dateField.addToPage(page, { x: x + sigW * 0.65, y: tdY + 1, width: sigW * 0.35 - 2, height: 0.22 * inch, borderWidth: 0, backgroundColor: white, textColor: charcoal, font: reg, fontSize: 9 });
  };

  sigBlock(leftX,  sigTop, 'A & J CALIFORNIA BUILDERS, INC. - AUTHORIZED SIGNATURE', 'aj');
  sigBlock(rightX, sigTop, 'ACCEPTED BY - GENERAL CONTRACTOR / OWNER', 'gc');

  page.drawRectangle({ x: 0, y: 0, width: W612, height: 0.18 * inch, color: gold });
  const ftxt  = 'A & J California Builders, Inc.  |  License # 949668  |  1261 Lincoln Ave, Suite 106, San Jose, CA 95125  |  408-690-7421';
  const ftxtW = reg.widthOfTextAtSize(ftxt, 7);
  page.drawText(ftxt, { x: (W612 - ftxtW) / 2, y: 0.25 * inch, size: 7, font: reg, color: midGray });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ── Routes ────────────────────────────────────────────────────

// GET all active jobs
app.get('/api/jobs', (req, res) => {
  const jobs = db.prepare('SELECT * FROM jobs WHERE active = 1 ORDER BY job_number DESC').all();
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

// DELETE job (admin)
app.delete('/api/jobs/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE jobs SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET all active GCs
app.get('/api/gcs', (req, res) => {
  const gcs = db.prepare('SELECT * FROM gcs WHERE active = 1 ORDER BY name').all();
  res.json(gcs);
});

// POST new GC (admin)
app.post('/api/gcs', requireAdmin, (req, res) => {
  const { name, address } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const result = db.prepare('INSERT INTO gcs (name, address) VALUES (?, ?)').run(name, address || '');
    res.json({ id: result.lastInsertRowid, name, address });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE GC (admin)
app.delete('/api/gcs/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE gcs SET active = 0 WHERE id = ?').run(req.params.id);
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

// POST T&M submission
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
    + (d.office_message ? emailRow('📝 Message to Office', d.office_message) : '')
    + `</table>`
    + emailCostBox(mat.toFixed(2), lab.toFixed(2), total.toFixed(2), 'TOTAL T&amp;M AMOUNT')
    + emailFooter();

  try {
    await resend.emails.send({
      from: 'AJ Field App <field@bayareacaliforniabuilders.com>',
      to: OFFICE_EMAILS,
      subject: `T&M Tag — ${d.job || 'Unassigned'} — ${d.date || new Date().toLocaleDateString()}`,
      html
    });
    if (d.submitter_email) {
      await resend.emails.send({
        from: 'AJ Field App <field@bayareacaliforniabuilders.com>',
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

// POST Change Order submission
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
    + (d.office_message ? emailRow('📝 Message to Office', d.office_message) : '')
    + `</table>`
    + emailCostBox(mat.toFixed(2), lab.toFixed(2), total.toFixed(2), 'TOTAL CHANGE ORDER AMOUNT')
    + emailFooter();

  try {
    const payload = {
      from: 'AJ Field App <field@bayareacaliforniabuilders.com>',
      to: OFFICE_EMAILS,
      subject: `Change Order — ${d.job || 'Unassigned'} — ${d.date || new Date().toLocaleDateString()}`,
      html
    };
    if (pdfBuffer) {
      payload.attachments = [{
        filename: `CO_${(d.job || 'Unassigned').replace(/[^a-z0-9]/gi, '_')}_${d.date || 'draft'}.pdf`,
        content: pdfBuffer.toString('base64')
      }];
    }
    const coSendResult = await resend.emails.send(payload);
    console.log('Resend CO send result:', JSON.stringify(coSendResult));

    if (d.submitter_email) {
      await resend.emails.send({
        from: 'AJ Field App <field@bayareacaliforniabuilders.com>',
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
