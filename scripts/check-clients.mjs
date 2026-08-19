import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');

function loadEnv(path) {
  const text = readFileSync(path, 'utf8');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    v = v.replace(/\\\$/g, '$');
    vars[m[1]] = v;
  }
  return vars;
}

const env = loadEnv(envPath);

const admin = await import('firebase-admin');
const firebase = admin.default ?? admin;

firebase.initializeApp({
  credential: firebase.credential.cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = firebase.firestore();

const snap = await db.collection('clients').get();
if (snap.empty) {
  console.log('No clients found in Firestore');
  process.exit(0);
}

for (const doc of snap.docs) {
  const data = doc.data();
  console.log('Client ID:', doc.id);
  console.log('  name:', data.name);
  console.log('  ad_account_id:', data.ad_account_id || '(not set)');
  console.log('  access_token_encrypted:', data.access_token_encrypted ? 'YES (' + String(data.access_token_encrypted).length + ' chars)' : 'NO');
  console.log('  primary_goal:', data.primary_goal || '(not set)');
  console.log('  settings:', JSON.stringify(data.settings || {}));

  // Check campaigns
  const campSnap = await db.collection('campaigns').doc(doc.id).collection('campaign_items').get();
  console.log('  campaigns:', campSnap.size);

  // Check insights
  const insSnap = await db.collection('daily_insights').doc(doc.id).collection('insight_items').limit(5).get();
  console.log('  insights (sample 5):', insSnap.size > 0 ? insSnap.docs.map(d => { const v = d.data(); return v.date + ' ' + v.campaign_name + ' spend=' + v.spend; }).join(' | ') : '(none)');

  console.log('');
}

process.exit(0);
