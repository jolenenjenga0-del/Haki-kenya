const bcrypt = require('bcryptjs');
const { initDatabase, db } = require('./database');
const { scoreCandidate, generateBlockchainHash } = require('./ai-engine');

async function runSeed(verbose) {
  if (verbose) console.log('Seeding database...');

  const existingRecruiter = db.prepare('SELECT id FROM users WHERE email = ?').get('recruiter@psc.go.ke');
  if (existingRecruiter) {
    if (verbose) console.log('Database already seeded. Skipping.');
    return;
  }

  const hash = await bcrypt.hash('password123', 10);

  db.prepare(`INSERT INTO users (unique_code, name, email, password, role) VALUES (?, ?, ?, ?, ?)`)
    .run('HK-ADMIN-001', 'Admin User', 'admin@haki.go.ke', hash, 'admin');

  db.prepare(`INSERT INTO users (unique_code, name, email, password, role) VALUES (?, ?, ?, ?, ?)`)
    .run('HK-PSC-R001', 'Grace Wanjiku', 'recruiter@psc.go.ke', hash, 'recruiter');

  db.prepare(`INSERT INTO users (unique_code, name, email, password, role, national_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('HK-A7F3B2C1', 'James Ochieng', 'james@example.com', hash, 'applicant', '12345678', '0712345678');
  db.prepare('INSERT INTO applicants (user_id, bio, skills, education, experience) VALUES (?, ?, ?, ?, ?)')
    .run(3, 'Experienced chemist with 5 years in public health labs.',
      'Chemistry, Laboratory Analysis, ISO 17025, Quality Control, Research, Data Analysis, Spectrophotometry, Chromatography',
      'BSc Industrial Chemistry, Maseno University (2021)\nMSc Analytical Chemistry, University of Nairobi (2023)',
      '5 years at Kenya Medical Research Institute (KEMRI)\n2 years as Lab Analyst at Kenya Bureau of Standards');

  db.prepare(`INSERT INTO users (unique_code, name, email, password, role, national_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('HK-D4E5F6G7', 'Amina Hassan', 'amina@example.com', hash, 'applicant', '23456789', '0722345678');
  db.prepare('INSERT INTO applicants (user_id, bio, skills, education, experience) VALUES (?, ?, ?, ?, ?)')
    .run(4, 'Public health specialist passionate about policy and community health.',
      'Public Health, Epidemiology, Data Analysis, SPSS, Policy Analysis, Community Outreach, Research, Monitoring & Evaluation',
      'BSc Public Health, Moi University (2020)\nMPH, University of Nairobi (2022)',
      '3 years at Ministry of Health\n2 years at WHO Kenya as Program Coordinator');

  db.prepare(`INSERT INTO users (unique_code, name, email, password, role, national_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('HK-H8I9J0K1', 'Brian Kiprop', 'brian@example.com', hash, 'applicant', '34567890', '0733456789');
  db.prepare('INSERT INTO applicants (user_id, bio, skills, education, experience) VALUES (?, ?, ?, ?, ?)')
    .run(5, 'IT professional with focus on government digital transformation.',
      'Software Development, Python, JavaScript, Database Management, Cybersecurity, Cloud Computing, Project Management, Agile',
      'BSc Computer Science, JKUAT (2019)\nCertified in AWS Solutions Architecture',
      '4 years as IT Officer at ICT Authority\n2 years as Systems Developer at Safaricom');

  // Create jobs
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO jobs (title, description, requirements, department, location, recruiter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('Industrial Chemist',
      'Join the Ministry of Health as an Industrial Chemist. You will be responsible for quality assurance of pharmaceutical products, laboratory analysis, and regulatory compliance. The role involves testing drug samples, maintaining lab standards, and preparing technical reports.',
      'BSc in Industrial Chemistry or Analytical Chemistry\n3+ years laboratory experience\nKnowledge of ISO 17025 standards\nExperience with HPLC, GC-MS, and spectrophotometry\nData analysis and report writing skills\nRegistered with Kenya Chemistry Society',
      'Ministry of Health', 'Nairobi', 2, 'open', now);

  db.prepare(`INSERT INTO jobs (title, description, requirements, department, location, recruiter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('Public Health Officer',
      'The County Government of Nakuru seeks a Public Health Officer to coordinate community health programs, disease surveillance, and health promotion activities. You will work with local health facilities and community health workers.',
      'BSc in Public Health or related field\n2+ years experience in public health programs\nExperience with disease surveillance systems\nKnowledge of Kenya community health strategy\nData analysis and reporting skills\nValid practicing license',
      'County Government of Nakuru', 'Nakuru', 2, 'open', now);

  db.prepare(`INSERT INTO jobs (title, description, requirements, department, location, recruiter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ICT Officer',
      'The Public Service Commission seeks an ICT Officer to manage digital systems, support e-government initiatives, and ensure cybersecurity across government platforms.',
      'BSc in Computer Science, IT, or related field\n3+ years experience in IT\nKnowledge of cybersecurity best practices\nExperience with database management\nProject management skills\nCertification in relevant technologies',
      'Public Service Commission', 'Nairobi', 2, 'open', now);

  // Create some applications with AI scoring
  const applicants_data = [
    { email: 'james@example.com', jobId: 1 },
    { email: 'amina@example.com', jobId: 2 },
    { email: 'brian@example.com', jobId: 3 },
    { email: 'james@example.com', jobId: 2 },
    { email: 'brian@example.com', jobId: 1 }
  ];

  for (const { email, jobId } of applicants_data) {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    const app = db.prepare('SELECT * FROM applicants WHERE user_id = ?').get(user.id);
    const applicantName = user.id === 3 ? 'James Ochieng' : user.id === 4 ? 'Amina Hassan' : 'Brian Kiprop';
    const cvText = `Name: ${applicantName}
Skills: ${app.skills}
Education: ${app.education}
Experience: ${app.experience}
Bio: ${app.bio}`;

    const result = scoreCandidate(cvText, job.requirements, job.description);
    const hash = generateBlockchainHash({ applicantId: app.id, jobId, score: result.score });

    db.prepare(`INSERT INTO applications (job_id, applicant_id, cv_text, ai_score, ai_summary, criteria_matched, blockchain_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(jobId, app.id, cvText, result.score, result.summary,
        JSON.stringify(result.matchedCriteria), hash);
  }

  // Shortlist some
  const topApp1 = db.prepare('SELECT * FROM applications WHERE job_id = 1 ORDER BY ai_score DESC LIMIT 1').get();
  if (topApp1) {
    const code = db.prepare(`SELECT u.unique_code FROM applications a
      JOIN applicants ap ON a.applicant_id = ap.id
      JOIN users u ON ap.user_id = u.id WHERE a.id = ?`).get(topApp1.id);

    db.prepare('UPDATE applications SET shortlisted = 1, shortlist_reason = ?, status = ? WHERE id = ?')
      .run('Top candidate — strong match in Industrial Chemistry qualifications and lab experience', 'shortlisted', topApp1.id);

    db.prepare('INSERT INTO shortlist_public (job_id, applicant_code, score, criteria, reason, verification_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(1, code.unique_code, topApp1.ai_score,
        'Top 10% in Industrial Chemistry qualifications and lab experience',
        'AI identified strong match across all core requirements',
        generateBlockchainHash({ job: 1, code: code.unique_code, action: 'shortlist_seed' }));
  }

  const topApp2 = db.prepare('SELECT * FROM applications WHERE job_id = 2 ORDER BY ai_score DESC LIMIT 1').get();
  if (topApp2) {
    const code = db.prepare(`SELECT u.unique_code FROM applications a
      JOIN applicants ap ON a.applicant_id = ap.id
      JOIN users u ON ap.user_id = u.id WHERE a.id = ?`).get(topApp2.id);

    db.prepare('UPDATE applications SET shortlisted = 1, shortlist_reason = ?, status = ? WHERE id = ?')
      .run('Excellent public health background with relevant field experience', 'shortlisted', topApp2.id);

    db.prepare('INSERT INTO shortlist_public (job_id, applicant_code, score, criteria, reason, verification_hash) VALUES (?, ?, ?, ?, ?, ?)')
      .run(2, code.unique_code, topApp2.ai_score,
        'Strong public health qualifications and practical experience',
        'AI evaluation: candidate matches 85% of requirements',
        generateBlockchainHash({ job: 2, code: code.unique_code, action: 'shortlist_seed' }));
  }

  if (verbose) {
    console.log('Seed complete!');
    console.log('');
    console.log('=== DEMO ACCOUNTS ===');
    console.log('Admin:     admin@haki.go.ke / password123');
    console.log('Recruiter: recruiter@psc.go.ke / password123');
    console.log('Applicant: james@example.com   / password123 (Code: HK-A7F3B2C1)');
    console.log('Applicant: amina@example.com   / password123 (Code: HK-D4E5F6G7)');
    console.log('Applicant: brian@example.com   / password123 (Code: HK-H8I9J0K1)');
    console.log('');
    console.log('Public shortlist: http://localhost:3000/public/shortlist');
  }
}

module.exports = { runSeed };

if (require.main === module) {
  initDatabase().then(() => runSeed(true)).then(() => {
    console.log('Seed complete!');
    console.log('');
    console.log('=== DEMO ACCOUNTS ===');
    console.log('Admin:     admin@haki.go.ke / password123');
    console.log('Recruiter: recruiter@psc.go.ke / password123');
    console.log('Applicant: james@example.com   / password123 (Code: HK-A7F3B2C1)');
    console.log('Applicant: amina@example.com   / password123 (Code: HK-D4E5F6G7)');
    console.log('Applicant: brian@example.com   / password123 (Code: HK-H8I9J0K1)');
    console.log('');
    console.log('Public shortlist: http://localhost:3000/public/shortlist');
  }).catch(console.error);
}
