const crypto = require('crypto');

function extractKeywords(text) {
  if (!text) return [];
  const stopWords = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','by','with',
    'is','are','was','were','be','been','being','have','has','had','do','does',
    'did','will','would','could','should','may','might','shall','can','need',
    'this','that','these','those','i','me','my','we','our','you','your','he',
    'she','it','they','them','their','its','from','as','about','into','over',
    'after','before','between','under','above','below','out','off','up','down',
    'also','very','just','than','then','now','each','every','all','both','no',
    'not','only','same','so','too','very','well','more','most','some','any'
  ]);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
  return [...new Set(words.filter(w => w.length > 2 && !stopWords.has(w)))];
}

function scoreCandidate(cvText, jobRequirements, jobDescription) {
  const cvKeywords = extractKeywords(cvText);
  const reqKeywords = extractKeywords(jobRequirements);
  const descKeywords = extractKeywords(jobDescription);

  const allJobKeywords = [...new Set([...reqKeywords, ...descKeywords])];

  const matched = [];
  const missing = [];
  let matchCount = 0;

  for (const keyword of allJobKeywords) {
    if (cvKeywords.includes(keyword)) {
      matched.push(keyword);
      matchCount++;
    } else {
      missing.push(keyword);
    }
  }

  const score = allJobKeywords.length > 0
    ? Math.round((matchCount / allJobKeywords.length) * 100)
    : 0;

  const educationKeywords = ['bachelor','master','phd','degree','diploma','certificate',
    'bsc','msc','b.a.','m.a.','ph.d','hnd','kcse','kce','form four','university','college',
    'school','graduate','postgraduate','undergraduate'];
  const eduMatch = educationKeywords.filter(k => cvKeywords.includes(k));
  const eduScore = eduMatch.length > 0 ? Math.min(20, eduMatch.length * 5) : 0;

  const experienceKeywords = ['year','years','experience','worked','work','intern',
    'internship','training','trained','manager','supervisor','lead','senior','junior',
    'assistant','coordinator','officer','analyst','specialist','consultant'];
  const expMatch = experienceKeywords.filter(k => cvKeywords.includes(k));
  const expScore = Math.min(20, expMatch.length * 3);

  const finalScore = Math.min(100, Math.round(score * 0.6 + eduScore + expScore));

  const criteriaList = matched.slice(0, 10).map(k =>
    `Matched skill/credential: "${k}"`
  );

  if (eduMatch.length > 0) {
    criteriaList.push(`Education level detected: "${eduMatch.join(', ')}"`);
  }

  if (expMatch.length > 0) {
    criteriaList.push(`Experience indicators found: "${expMatch.join(', ')}"`);
  }

  const topStrengths = [];
  if (eduScore >= 10) topStrengths.push('strong educational background');
  if (expScore >= 10) topStrengths.push('relevant experience indicators');
  if (score >= 50) topStrengths.push(`${Math.round(score)}% keyword relevance to job requirements`);
  if (matched.length > 5) topStrengths.push(`matched ${matched.length} key requirements`);

  let summary = '';
  if (finalScore >= 70) {
    summary = `Strong candidate. ${topStrengths.join('. ')}. Highly suited for this role.`;
  } else if (finalScore >= 45) {
    summary = `Moderate candidate. ${topStrengths.join('. ')}. Shows potential with some gaps.`;
  } else {
    summary = `Limited match. ${topStrengths.length > 0 ? topStrengths.join('. ') + '.' : 'Few direct matches with requirements.'} Consider reviewing for non-technical qualifications.`;
  }

  return {
    score: finalScore,
    summary,
    matchedCriteria: criteriaList,
    matchedKeywords: matched,
    missingKeywords: missing,
    strengths: topStrengths
  };
}

function generateBlockchainHash(data) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(data) + Date.now().toString());
  return hash.digest('hex');
}

module.exports = { scoreCandidate, generateBlockchainHash, extractKeywords };
