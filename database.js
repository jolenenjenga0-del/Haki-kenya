let initSqlJs, fs, path;

try {
  initSqlJs = require('sql.js');
  fs = require('fs');
  path = require('path');
} catch (e) {
  console.error('Failed to load database deps:', e);
}

const isVercel = !!(process.env.VERCEL === '1' || process.env.VERCEL_ENV);
const DB_PATH = isVercel ? '/tmp/haki_kenya.db' : (__dirname ? path?.join(__dirname, 'haki_kenya.db') : 'haki_kenya.db');
let db = null;

function saveDB() {
  try {
    if (db && DB_PATH) {
      const data = db.export();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    }
  } catch (err) {
    console.warn('DB save skipped:', err.message);
  }
}

function makeStmt(sql) {
  return {
    get(...params) {
      try {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
        stmt.free();
      } catch (e) { console.error('DB get error:', e); }
      return undefined;
    },
    all(...params) {
      try {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      } catch (e) { console.error('DB all error:', e); }
      return [];
    },
    run(...params) {
      try {
        db.run(sql, params);
        saveDB();
      } catch (e) { console.error('DB run error:', e); }
    }
  };
}

const dbWrapper = { prepare: (sql) => makeStmt(sql), exec: (sql) => db ? db.exec(sql) : [] };

async function initDatabase() {
  try {
    const SQL = await initSqlJs();

    if (DB_PATH && fs.existsSync(DB_PATH)) {
      const buf = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buf);
    } else {
      db = new SQL.Database();
    }

    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, unique_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT CHECK(role IN ('applicant','recruiter','admin')) NOT NULL DEFAULT 'applicant', national_id TEXT, phone TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL, requirements TEXT NOT NULL, department TEXT NOT NULL, location TEXT, recruiter_id INTEGER NOT NULL, status TEXT CHECK(status IN ('open','closed')) NOT NULL DEFAULT 'open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS applicants (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, bio TEXT, skills TEXT, education TEXT, experience TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, applicant_id INTEGER NOT NULL, filename TEXT NOT NULL, content_text TEXT, doc_type TEXT DEFAULT 'cv', uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, applicant_id INTEGER NOT NULL, cv_text TEXT, ai_score REAL DEFAULT 0, ai_summary TEXT, criteria_matched TEXT, shortlisted INTEGER DEFAULT 0, shortlist_reason TEXT, blockchain_hash TEXT, status TEXT CHECK(status IN ('pending','reviewed','shortlisted','rejected')) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS shortlist_public (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, applicant_code TEXT NOT NULL, score REAL NOT NULL, criteria TEXT NOT NULL, reason TEXT, verification_hash TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

    saveDB();
    return dbWrapper;
  } catch (err) {
    console.error('Database init failed:', err);
    throw err;
  }
}

module.exports = { initDatabase, db: dbWrapper };
