const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'haki_kenya.db');
let db = null;

function saveDB() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

const dbWrapper = {
  prepare(sql) {
    return {
      get(...params) {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      run(...params) {
        try {
          db.run(sql, params);
          saveDB();
        } catch (err) {
          console.error('DB error:', sql, params, err.message);
          throw err;
        }
      }
    };
  },
  exec(sql) {
    return db.exec(sql);
  }
};

async function initDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unique_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT CHECK(role IN ('applicant','recruiter','admin')) NOT NULL DEFAULT 'applicant',
    national_id TEXT,
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT NOT NULL,
    department TEXT NOT NULL,
    location TEXT,
    recruiter_id INTEGER NOT NULL,
    status TEXT CHECK(status IN ('open','closed')) NOT NULL DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applicants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE NOT NULL,
    bio TEXT,
    skills TEXT,
    education TEXT,
    experience TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    content_text TEXT,
    doc_type TEXT DEFAULT 'cv',
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    applicant_id INTEGER NOT NULL,
    cv_text TEXT,
    ai_score REAL DEFAULT 0,
    ai_summary TEXT,
    criteria_matched TEXT,
    shortlisted INTEGER DEFAULT 0,
    shortlist_reason TEXT,
    blockchain_hash TEXT,
    status TEXT CHECK(status IN ('pending','reviewed','shortlisted','rejected')) DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shortlist_public (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    applicant_code TEXT NOT NULL,
    score REAL NOT NULL,
    criteria TEXT NOT NULL,
    reason TEXT,
    verification_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  saveDB();
  return dbWrapper;
}

module.exports = { initDatabase, db: dbWrapper };
