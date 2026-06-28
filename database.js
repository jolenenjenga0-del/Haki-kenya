const crypto = require('crypto');

let DATA = {}, nextIds = {};
const TABLES = ['users', 'jobs', 'applicants', 'documents', 'applications', 'shortlist_public'];
TABLES.forEach(t => { DATA[t] = []; nextIds[t] = 1; });

function ids(table) { return nextIds[table]++; }

const db = {
  prepare(sql) {
    const lower = sql.toLowerCase().trim();
    const tbl = (lower.match(/(?:from|into|update|table)\s+(\w+)/) || [])[1];

    const filterCol = (() => {
      const m = sql.match(/(\w+)\s*=\s*\?/);
      return m ? m[1] : null;
    })();

    const filterCol2 = (() => {
      const parts = [...sql.matchAll(/(\w+)\s*=\s*\?/g)];
      return parts.length > 1 ? parts[1][1] : null;
    })();

    const orderCol = (() => {
      const m = sql.match(/order by\s+(\w+)\s*(desc|asc)?/i);
      return m ? { col: m[1], dir: (m[2] || 'asc').toLowerCase() } : null;
    })();

    const isJoin = lower.includes(' join ');
    const isCount = lower.includes('count(*)');
    const isDistinct = lower.includes('select distinct');
    const limitMatch = sql.match(/limit\s+(\d+)/i);
    const limitVal = limitMatch ? parseInt(limitMatch[1]) : null;

    const joinInfo = (() => {
      if (!isJoin) return null;
      const joinParts = [...sql.matchAll(/join\s+(\w+)\s+on\s+\w+\.(\w+)\s*=\s*(\w+)\.(\w+)/ig)];
      return joinParts.map(p => ({ table: p[1], leftCol: p[2], rightTable: p[3], rightCol: p[4] }));
    })();

    return {
      get(...params) {
        if (!tbl || !DATA[tbl]) return undefined;

        if (isCount) {
          let rows = DATA[tbl];
          if (filterCol && params.length > 0) rows = rows.filter(r => r[filterCol] === params[0]);
          if (filterCol2 && params.length > 1) rows = rows.filter(r => r[filterCol2] === params[1]);
          if (sql.includes('shortlisted')) rows = rows.filter(r => r.shortlisted === 1);
          return { c: rows.length };
        }

        let rows = DATA[tbl];
        if (filterCol && params.length > 0) rows = rows.filter(r => r[filterCol] === params[0]);

        if (sql.includes('status = ?')) {
          const statusMatch = sql.match(/status\s*=\s*'(\w+)'/);
          if (statusMatch) rows = rows.filter(r => r.status === statusMatch[1]);
        }

        return rows.length > 0 ? rows[0] : undefined;
      },

      all(...params) {
        if (!tbl || !DATA[tbl]) return [];

        if (isJoin && sql.includes('shortlist_public') && sql.includes('jobs')) {
          return DATA.shortlist_public.map(s => {
            const job = DATA.jobs.find(j => j.id === s.job_id);
            return { ...s, title: job?.title, department: job?.department };
          });
        }

        if (isJoin && sql.includes('applications')) {
          let apps = [...DATA.applications];
          if (filterCol && params.length > 0) apps = apps.filter(a => a[filterCol] === params[0]);

          return apps.map(a => {
            const ap = DATA.applicants.find(x => x.id === a.applicant_id);
            const u = DATA.users.find(x => x.id === ap?.user_id);
            const j = DATA.jobs.find(x => x.id === a.job_id);
            return {
              ...a,
              applicant_code: u?.unique_code || null,
              skills: ap?.skills || null,
              education: ap?.education || null,
              experience: ap?.experience || null,
              job_title: j?.title || null,
              department: j?.department || null
            };
          });
        }

        let rows = [...DATA[tbl]];
        if (filterCol && params.length > 0) rows = rows.filter(r => r[filterCol] === params[0]);

        if (orderCol) rows.sort((a, b) => (orderCol.dir === 'desc' ? -1 : 1) * (a[orderCol.col] > b[orderCol.col] ? 1 : -1));

        if (limitVal) rows = rows.slice(0, limitVal);

        if (isDistinct) {
          const seen = new Set();
          rows = rows.filter(r => { const k = r.id; if (seen.has(k)) return false; seen.add(k); return true; });
        }

        return rows;
      },

      run(...params) {
        if (!tbl || !DATA[tbl]) return;

        if (lower.includes('insert')) {
          const colsMatch = sql.match(/\(([^)]+)\)\s*values/i);
          const cols = colsMatch ? colsMatch[1].split(',').map(c => c.trim()) : [];
          const row = { id: ids(tbl) };
          cols.forEach((c, i) => row[c] = params[i] !== undefined ? params[i] : null);
          DATA[tbl].push(row);
          return;
        }

        if (lower.includes('update')) {
          const setMatch = sql.match(/set\s+(.+?)(?:where|$)/i);
          if (!setMatch) return;
          const setCols = setMatch[1].split(',').map(s => s.trim().match(/(\w+)\s*=\s*\?/)).filter(Boolean).map(m => m[1]);

          let rows = [...DATA[tbl]];
          if (filterCol) {
            const fv = params[setCols.length];
            rows = rows.filter(r => r[filterCol] === fv);
          }
          rows.forEach(r => setCols.forEach((c, i) => r[c] = params[i]));
          return;
        }
      }
    };
  },
  exec() { return []; }
};

function seed() {
  const bcrypt = require('bcryptjs');
  const { scoreCandidate, generateBlockchainHash } = require('./ai-engine');
  const hash = bcrypt.hashSync('password123', 10);
  const now = new Date().toISOString();

  DATA.users = [
    { id: 1, unique_code: 'HK-ADMIN-001', name: 'Admin User', email: 'admin@haki.go.ke', password: hash, role: 'admin', created_at: now },
    { id: 2, unique_code: 'HK-PSC-R001', name: 'Grace Wanjiku', email: 'recruiter@psc.go.ke', password: hash, role: 'recruiter', created_at: now },
    { id: 3, unique_code: 'HK-A7F3B2C1', name: 'James Ochieng', email: 'james@example.com', password: hash, role: 'applicant', created_at: now },
    { id: 4, unique_code: 'HK-D4E5F6G7', name: 'Amina Hassan', email: 'amina@example.com', password: hash, role: 'applicant', created_at: now },
    { id: 5, unique_code: 'HK-H8I9J0K1', name: 'Brian Kiprop', email: 'brian@example.com', password: hash, role: 'applicant', created_at: now }
  ];
  nextIds.users = 6;

  DATA.applicants = [
    { id: 1, user_id: 3, bio: 'Experienced chemist with 5 years in public health labs.', skills: 'Chemistry, Laboratory Analysis, ISO 17025, Quality Control, Research, Data Analysis, Spectrophotometry, Chromatography', education: 'BSc Industrial Chemistry, Maseno University (2021)\nMSc Analytical Chemistry, University of Nairobi (2023)', experience: '5 years at KEMRI\n2 years at Kenya Bureau of Standards', created_at: now },
    { id: 2, user_id: 4, bio: 'Public health specialist.', skills: 'Public Health, Epidemiology, Data Analysis, SPSS, Policy Analysis, Community Outreach, Research, M&E', education: 'BSc Public Health, Moi University (2020)\nMPH, University of Nairobi (2022)', experience: '3 years at Ministry of Health\n2 years at WHO Kenya', created_at: now },
    { id: 3, user_id: 5, bio: 'IT professional.', skills: 'Python, JavaScript, Database Management, Cybersecurity, Cloud Computing, Project Management', education: 'BSc Computer Science, JKUAT (2019)\nAWS Certified', experience: '4 years at ICT Authority\n2 years at Safaricom', created_at: now }
  ];
  nextIds.applicants = 4;

  DATA.jobs = [
    { id: 1, title: 'Industrial Chemist', description: 'Quality assurance of pharmaceutical products for Ministry of Health.', requirements: 'BSc Industrial Chemistry\n3+ years lab experience\nISO 17025\nHPLC, GC-MS\nData analysis', department: 'Ministry of Health', location: 'Nairobi', recruiter_id: 2, status: 'open', created_at: now },
    { id: 2, title: 'Public Health Officer', description: 'Coordinate community health programs for County Government of Nakuru.', requirements: 'BSc Public Health\n2+ years experience\nDisease surveillance\nData analysis', department: 'County Government of Nakuru', location: 'Nakuru', recruiter_id: 2, status: 'open', created_at: now },
    { id: 3, title: 'ICT Officer', description: 'Manage digital systems for Public Service Commission.', requirements: 'BSc Computer Science\n3+ years IT experience\nCybersecurity\nDatabase management', department: 'Public Service Commission', location: 'Nairobi', recruiter_id: 2, status: 'open', created_at: now }
  ];
  nextIds.jobs = 4;

  const appData = [
    { a: 1, j: 1, skills: DATA.applicants[0].skills, edu: DATA.applicants[0].education, exp: DATA.applicants[0].experience, bio: DATA.applicants[0].bio, name: 'James Ochieng' },
    { a: 2, j: 2, skills: DATA.applicants[1].skills, edu: DATA.applicants[1].education, exp: DATA.applicants[1].experience, bio: DATA.applicants[1].bio, name: 'Amina Hassan' },
    { a: 3, j: 3, skills: DATA.applicants[2].skills, edu: DATA.applicants[2].education, exp: DATA.applicants[2].experience, bio: DATA.applicants[2].bio, name: 'Brian Kiprop' },
    { a: 1, j: 2, skills: DATA.applicants[0].skills, edu: DATA.applicants[0].education, exp: DATA.applicants[0].experience, bio: DATA.applicants[0].bio, name: 'James Ochieng' },
    { a: 3, j: 1, skills: DATA.applicants[2].skills, edu: DATA.applicants[2].education, exp: DATA.applicants[2].experience, bio: DATA.applicants[2].bio, name: 'Brian Kiprop' }
  ];

  appData.forEach((a, idx) => {
    const job = DATA.jobs.find(j => j.id === a.j);
    const cv = `Name: ${a.name}\nSkills: ${a.skills}\nEducation: ${a.edu}\nExperience: ${a.exp}\nBio: ${a.bio}`;
    const result = scoreCandidate(cv, job.requirements, job.description);
    DATA.applications.push({
      id: idx + 1, job_id: a.j, applicant_id: a.a, cv_text: cv,
      ai_score: result.score, ai_summary: result.summary,
      criteria_matched: JSON.stringify(result.matchedCriteria),
      shortlisted: 0, shortlist_reason: null,
      blockchain_hash: generateBlockchainHash({ applicantId: a.a, jobId: a.j }),
      status: 'pending', created_at: now
    });
  });
  nextIds.applications = 6;

  [1, 2].forEach(jobId => {
    const top = DATA.applications.filter(a => a.job_id === jobId).sort((a, b) => b.ai_score - a.ai_score)[0];
    if (top) {
      top.shortlisted = 1; top.status = 'shortlisted';
      const ap = DATA.applicants.find(x => x.id === top.applicant_id);
      const u = DATA.users.find(x => x.id === ap?.user_id);
      if (u) {
        DATA.shortlist_public.push({
          id: DATA.shortlist_public.length + 1, job_id: jobId,
          applicant_code: u.unique_code, score: top.ai_score,
          criteria: jobId === 1 ? 'Top Industrial Chemistry score' : 'Top Public Health score',
          reason: top.ai_summary,
          verification_hash: generateBlockchainHash({ job: jobId, code: u.unique_code }),
          created_at: now
        });
      }
    }
  });
  nextIds.shortlist_public = 3;

  console.log('Demo seeded.');
}

seed();

module.exports = { initDatabase: async () => db, db };
