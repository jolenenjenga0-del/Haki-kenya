const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./database');
const { scoreCandidate, generateBlockchainHash } = require('./ai-engine');

const app = express();

const ROOT = process.env.VERCEL ? process.cwd() : __dirname;
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'haki-kenya-dev-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const uploadDir = process.env.VERCEL ? '/tmp/uploads' : path.join(ROOT, 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, fileSize: 5 * 1024 * 1024 });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(req.session.userId);
    if (!user || user.role !== role) return res.status(403).send('Access denied');
    next();
  };
}

function getSessionUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, unique_code, name, email, role FROM users WHERE id = ?').get(req.session.userId);
}

// === AUTH ===
app.get('/', (req, res) => {
  const user = getSessionUser(req);
  const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE status = ?').get('open');
  const applicantCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('applicant');
  const placementCount = db.prepare('SELECT COUNT(*) as c FROM applications WHERE shortlisted = 1').get();
  res.render('index', { user, stats: { jobs: jobCount?.c || 0, applicants: applicantCount?.c || 0, placements: placementCount?.c || 0 } });
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('register', { user: null, error: null });
});

app.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, national_id, phone } = req.body;
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.render('register', { user: null, error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const uniqueCode = 'HK-' + uuidv4().substring(0, 8).toUpperCase();
    db.prepare(`INSERT INTO users (unique_code, name, email, password, role, national_id, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uniqueCode, name, email, hashed, role || 'applicant', national_id, phone);
    if ((role || 'applicant') === 'applicant') {
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      db.prepare('INSERT INTO applicants (user_id) VALUES (?)').run(user.id);
    }
    res.redirect('/login?registered=1');
  } catch (err) {
    res.render('register', { user: null, error: 'Registration failed' });
  }
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { user: null, error: null, registered: req.query.registered });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.render('login', { user: null, error: 'Invalid credentials', registered: null });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.render('login', { user: null, error: 'Invalid credentials', registered: null });
  req.session.userId = user.id;
  req.session.role = user.role;
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// === DASHBOARD ===
app.get('/dashboard', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  if (user.role === 'recruiter') return res.redirect('/recruiter/dashboard');
  if (user.role === 'admin') return res.redirect('/admin');
  const applicant = db.prepare('SELECT * FROM applicants WHERE user_id = ?').get(user.id);
  const applications = db.prepare(`SELECT a.*, j.title as job_title, j.department
    FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.applicant_id = ? ORDER BY a.created_at DESC`).all(applicant?.id);
  const openJobs = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE status = ?').get('open');
  res.render('dashboard', { user, applicant, applications, openJobs: openJobs?.c || 0, applied: req.query.applied });
});

// === PROFILE ===
app.get('/profile', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const applicant = db.prepare('SELECT * FROM applicants WHERE user_id = ?').get(user.id);
  const docs = db.prepare('SELECT * FROM documents WHERE applicant_id = ?').all(applicant?.id);
  res.render('profile', { user, applicant, docs, error: null, success: null });
});

app.post('/profile', requireAuth, async (req, res) => {
  const user = getSessionUser(req);
  const { bio, skills, education, experience } = req.body;
  const applicant = db.prepare('SELECT id FROM applicants WHERE user_id = ?').get(user.id);
  if (applicant) {
    db.prepare('UPDATE applicants SET bio=?, skills=?, education=?, experience=? WHERE user_id=?')
      .run(bio, skills, education, experience, user.id);
  }
  res.redirect('/profile');
});

app.post('/profile/upload-cv', requireAuth, upload.single('cv'), async (req, res) => {
  const user = getSessionUser(req);
  if (!req.file) return res.redirect('/profile');
  try {
    const applicant = db.prepare('SELECT id FROM applicants WHERE user_id = ?').get(user.id);
    let contentText = '';
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.txt') {
      contentText = fs.readFileSync(req.file.path, 'utf-8');
    } else if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(req.file.path);
      const data = await pdfParse(buf);
      contentText = data.text;
    } else if (ext === '.docx') {
      const mammoth = require('mammoth');
      const buf = fs.readFileSync(req.file.path);
      const result = await mammoth.extractRawText({ buffer: buf });
      contentText = result.value;
    }
    db.prepare('INSERT INTO documents (applicant_id, filename, content_text) VALUES (?, ?, ?)')
      .run(applicant.id, req.file.originalname, contentText);
  } catch (err) {
    console.error('CV upload error:', err);
  }
  res.redirect('/profile');
});

// === JOBS ===
app.get('/jobs', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const jobs = db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC').all('open');
  const applicant = db.prepare('SELECT id FROM applicants WHERE user_id = ?').get(user.id);
  const myApps = db.prepare('SELECT job_id FROM applications WHERE applicant_id = ?').all(applicant?.id || 0);
  const appliedJobIds = new Set(myApps.map(a => a.job_id));
  res.render('jobs', { user, jobs, appliedJobIds, error: null, applied: req.query.applied });
});

app.get('/jobs/:id/apply', requireAuth, (req, res) => {
  const user = getSessionUser(req);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND status = ?').get(req.params.id, 'open');
  if (!job) return res.status(404).send('Job not found');
  const applicant = db.prepare('SELECT * FROM applicants WHERE user_id = ?').get(user.id);
  const docs = db.prepare('SELECT * FROM documents WHERE applicant_id = ?').all(applicant?.id);
  const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?').get(job.id, applicant?.id);
  if (existing) return res.redirect('/jobs?applied=1');
  res.render('apply', { user, job, applicant, docs, error: null });
});

app.post('/jobs/:id/apply', requireAuth, async (req, res) => {
  const user = getSessionUser(req);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND status = ?').get(req.params.id, 'open');
  if (!job) return res.status(404).send('Job not found');
  const applicant = db.prepare('SELECT id FROM applicants WHERE user_id = ?').get(user.id);
  const existing = db.prepare('SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?').get(job.id, applicant.id);
  if (existing) return res.redirect('/jobs?applied=1');
  let finalCvText = req.body.cv_text || '';
  const docId = req.body.doc_id;
  if (docId) {
    const doc = db.prepare('SELECT content_text FROM documents WHERE id = ? AND applicant_id = ?').get(docId, applicant.id);
    if (doc && doc.content_text) finalCvText = doc.content_text;
  }
  const result = scoreCandidate(finalCvText, job.requirements, job.description);
  const hash = generateBlockchainHash({ job: job.id, applicant: applicant.id, score: result.score, timestamp: Date.now() });
  db.prepare(`INSERT INTO applications (job_id, applicant_id, cv_text, ai_score, ai_summary, criteria_matched, blockchain_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(job.id, applicant.id, finalCvText, result.score, result.summary,
      JSON.stringify(result.matchedCriteria), hash);
  res.redirect('/dashboard?applied=1');
});

// === RECRUITER ===
app.get('/recruiter/dashboard', requireRole('recruiter'), (req, res) => {
  const user = getSessionUser(req);
  const jobs = db.prepare('SELECT * FROM jobs WHERE recruiter_id = ? ORDER BY created_at DESC').all(user.id);
  const stats = {
    total: jobs.length,
    active: jobs.filter(j => j.status === 'open').length,
    totalApps: db.prepare(`SELECT COUNT(*) as c FROM applications a JOIN jobs j ON a.job_id = j.id WHERE j.recruiter_id = ?`).get(user.id)?.c || 0,
    shortlisted: db.prepare(`SELECT COUNT(*) as c FROM applications a JOIN jobs j ON a.job_id = j.id WHERE j.recruiter_id = ? AND a.shortlisted = 1`).get(user.id)?.c || 0
  };
  res.render('recruiter/dashboard', { user, jobs, stats });
});

app.get('/recruiter/jobs/create', requireRole('recruiter'), (req, res) => {
  const user = getSessionUser(req);
  res.render('recruiter/create-job', { user, error: null });
});

app.post('/recruiter/jobs/create', requireRole('recruiter'), (req, res) => {
  const user = getSessionUser(req);
  const { title, description, requirements, department, location } = req.body;
  db.prepare('INSERT INTO jobs (title, description, requirements, department, location, recruiter_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(title, description, requirements, department, location, user.id);
  res.redirect('/recruiter/dashboard');
});

app.get('/recruiter/jobs/:id', requireRole('recruiter'), (req, res) => {
  const user = getSessionUser(req);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?').get(req.params.id, user.id);
  if (!job) return res.status(404).send('Job not found');
  const applications = db.prepare(`
    SELECT a.*, u.unique_code as applicant_code, ap.skills, ap.education, ap.experience
    FROM applications a JOIN applicants ap ON a.applicant_id = ap.id JOIN users u ON ap.user_id = u.id
    WHERE a.job_id = ? ORDER BY a.ai_score DESC`).all(job.id);
  const shortlisted = applications.filter(a => a.shortlisted).length;
  res.render('recruiter/applicants', { user, job, applications, shortlisted });
});

app.post('/recruiter/applications/:id/shortlist', requireRole('recruiter'), (req, res) => {
  const user = getSessionUser(req);
  const app = db.prepare(`SELECT a.*, j.recruiter_id, j.id as job_id FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.id = ?`).get(req.params.id);
  if (!app || app.recruiter_id !== user.id) return res.status(403).send('Access denied');
  db.prepare('UPDATE applications SET shortlisted = 1, shortlist_reason = ?, status = ? WHERE id = ?')
    .run(req.body.reason || 'Shortlisted by AI screening results', 'shortlisted', app.id);
  const applicantCode = db.prepare(`SELECT u.unique_code FROM applications a JOIN applicants ap ON a.applicant_id = ap.id JOIN users u ON ap.user_id = u.id WHERE a.id = ?`).get(app.id);
  const criteria = req.body.criteria || 'AI Screening Score';
  const hash = generateBlockchainHash({ job: app.job_id, applicant: applicantCode.unique_code, action: 'shortlisted', timestamp: Date.now() });
  db.prepare('INSERT INTO shortlist_public (job_id, applicant_code, score, criteria, reason, verification_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(app.job_id, applicantCode.unique_code, app.ai_score, criteria, req.body.reason || 'Top candidate per AI evaluation', hash);
  res.redirect(`/recruiter/jobs/${app.job_id}`);
});

app.post('/recruiter/applications/:id/reject', requireRole('recruiter'), (req, res) => {
  const user = getSessionUser(req);
  const app = db.prepare(`SELECT a.*, j.recruiter_id, j.id as job_id FROM applications a JOIN jobs j ON a.job_id = j.id WHERE a.id = ?`).get(req.params.id);
  if (!app || app.recruiter_id !== user.id) return res.status(403).send('Access denied');
  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run('rejected', app.id);
  res.redirect(`/recruiter/jobs/${app.job_id}`);
});

// === PUBLIC SHORTLIST ===
app.get('/public/shortlist', (req, res) => {
  const jobs = db.prepare(`SELECT DISTINCT j.id, j.title, j.department FROM jobs j INNER JOIN shortlist_public s ON j.id = s.job_id ORDER BY j.title`).all();
  const selectedJobId = req.query.job_id;
  let entries = [];
  let currentJob = null;
  if (selectedJobId) {
    entries = db.prepare(`SELECT s.*, j.title as job_title, j.department FROM shortlist_public s JOIN jobs j ON s.job_id = j.id WHERE s.job_id = ? ORDER BY s.score DESC`).all(selectedJobId);
    currentJob = jobs.find(j => j.id == selectedJobId);
  }
  res.render('public/shortlist', { user: null, jobs, entries, currentJob, selectedJobId });
});

// === ADMIN ===
app.get('/admin', requireRole('admin'), (req, res) => {
  const user = getSessionUser(req);
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get()?.c || 0,
    applicants: db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('applicant')?.c || 0,
    recruiters: db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('recruiter')?.c || 0,
    jobs: db.prepare('SELECT COUNT(*) as c FROM jobs').get()?.c || 0,
    applications: db.prepare('SELECT COUNT(*) as c FROM applications').get()?.c || 0,
    shortlisted: db.prepare('SELECT COUNT(*) as c FROM applications WHERE shortlisted = 1').get()?.c || 0
  };
  const auditLog = db.prepare(`SELECT s.*, j.title FROM shortlist_public s JOIN jobs j ON s.job_id = j.id ORDER BY s.created_at DESC LIMIT 50`).all();
  res.render('admin', { user, stats, auditLog });
});

// === API ===
app.get('/api/applications/:id/analysis', requireRole('recruiter'), (req, res) => {
  const app = db.prepare(`SELECT a.*, u.unique_code, ap.skills, ap.education, ap.experience, j.title, j.requirements, j.description FROM applications a JOIN applicants ap ON a.applicant_id = ap.id JOIN users u ON ap.user_id = u.id JOIN jobs j ON a.job_id = j.id WHERE a.id = ?`).get(req.params.id);
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json({
    applicantCode: app.unique_code, score: app.ai_score, summary: app.ai_summary,
    criteria: JSON.parse(app.criteria_matched || '[]'), skills: app.skills,
    education: app.education, experience: app.experience,
    cvText: app.cv_text?.substring(0, 2000), jobTitle: app.title
  });
});

app.get('/debug-error', (req, res) => {
  res.json({
    vercel: process.env.VERCEL,
    cwd: process.cwd(),
    node: process.version,
    hasViews: require('fs').existsSync(require('path').join(process.env.VERCEL ? process.cwd() : __dirname, 'views')),
    hasPublic: require('fs').existsSync(require('path').join(process.env.VERCEL ? process.cwd() : __dirname, 'public')),
    env: Object.keys(process.env).filter(k => !k.includes('SECRET') && !k.includes('KEY') && !k.includes('TOKEN')).slice(0, 20)
  });
});

module.exports = { app };
