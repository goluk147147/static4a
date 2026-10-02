/**
 * Push setup checker + optional test sender.
 *
 *   node scripts/check-push.js            → checks config and prints what is ready / missing
 *   node scripts/check-push.js --topic    → also sends a test push to the "admins" topic
 *   node scripts/check-push.js --token XXX → also sends a test push to one device token
 *
 * It reads the SAME env/paths the server uses, so a green run here means the server
 * will send push too. No code changes needed — only the two Firebase files.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const C = { ok: '\x1b[32m', bad: '\x1b[31m', warn: '\x1b[33m', dim: '\x1b[90m', off: '\x1b[0m' };
const ok = (m) => console.log(`${C.ok}✓${C.off} ${m}`);
const bad = (m) => console.log(`${C.bad}✗${C.off} ${m}`);
const warn = (m) => console.log(`${C.warn}!${C.off} ${m}`);

const ROOT = path.resolve(__dirname, '..');
const MOBILE_GS = path.resolve(ROOT, '../mobile/google-services.json');

let hardFail = false;

console.log('\n=== 4A Store push setup check ===\n');

// 1. Mobile google-services.json
if (fs.existsSync(MOBILE_GS)) {
  try {
    const gs = JSON.parse(fs.readFileSync(MOBILE_GS, 'utf8'));
    const pkg = gs?.client?.[0]?.client_info?.android_client_info?.package_name;
    if (pkg === 'com.store4a.app') ok(`mobile/google-services.json present (package ${pkg})`);
    else { bad(`google-services.json package is "${pkg}", must be com.store4a.app`); hardFail = true; }
  } catch {
    bad('mobile/google-services.json is not valid JSON'); hardFail = true;
  }
} else {
  bad('mobile/google-services.json MISSING — download from Firebase (Android app, pkg com.store4a.app)');
  hardFail = true;
}

// 2. Server service account
const saEnv = process.env.FCM_SERVICE_ACCOUNT || '';
if (!saEnv) {
  bad('FCM_SERVICE_ACCOUNT not set in api-node/.env'); hardFail = true;
}
const saPath = saEnv ? path.resolve(ROOT, saEnv) : '';
let serviceAccount = null;
if (saPath && fs.existsSync(saPath)) {
  try {
    serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    if (serviceAccount.private_key && serviceAccount.client_email && serviceAccount.project_id) {
      ok(`service account present (project ${serviceAccount.project_id}, ${serviceAccount.client_email})`);
    } else { bad('service account JSON is missing private_key/client_email/project_id'); hardFail = true; }
  } catch {
    bad(`service account at ${saPath} is not valid JSON`); hardFail = true;
  }
} else if (saEnv) {
  bad(`service account file not found at ${saPath} — download it from Firebase → Project settings → Service accounts`);
  hardFail = true;
}

// 3. Project id match (helpful sanity check)
if (serviceAccount && fs.existsSync(MOBILE_GS)) {
  try {
    const gs = JSON.parse(fs.readFileSync(MOBILE_GS, 'utf8'));
    const gsProj = gs?.project_info?.project_id;
    if (gsProj && gsProj !== serviceAccount.project_id) {
      warn(`google-services.json project (${gsProj}) != service account project (${serviceAccount.project_id}) — must be the SAME Firebase project`);
    } else if (gsProj) {
      ok(`both files belong to the same Firebase project (${gsProj})`);
    }
  } catch { /* already reported above */ }
}

if (hardFail) {
  console.log(`\n${C.bad}Push is NOT ready.${C.off} Fix the ✗ items above, then run this again.\n`);
  process.exit(1);
}

ok('Config looks complete. Initializing firebase-admin…');

// 4. Actually initialize firebase-admin (this is exactly what the server does)
let admin;
try {
  admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  ok('firebase-admin initialized successfully — the server will send push.');
} catch (e) {
  bad(`firebase-admin init failed: ${e.message}`);
  process.exit(1);
}

// 5. Optional test send
(async () => {
  const args = process.argv.slice(2);
  const topic = args.includes('--topic');
  const tokIdx = args.indexOf('--token');
  const token = tokIdx !== -1 ? args[tokIdx + 1] : null;

  const payload = {
    notification: { title: '🔔 4A Store test', body: 'Push setup working! Yeh test notification hai.' },
    data: { type: 'test', link: '/' },
    android: { priority: 'high', notification: { channelId: 'orders', sound: 'default' } },
  };

  try {
    if (token) {
      const id = await admin.messaging().send({ ...payload, token });
      ok(`test push SENT to device token (id ${id})`);
    } else if (topic) {
      const id = await admin.messaging().send({ ...payload, topic: 'admins' });
      ok(`test push SENT to topic "admins" (id ${id}). Admin phones should receive it.`);
    } else {
      console.log(`\n${C.dim}Tip: add --topic to send a test push to all admins, or --token <FCM_TOKEN> to one device.${C.off}`);
    }
  } catch (e) {
    bad(`test send failed: ${e.message}`);
    process.exit(1);
  }
  console.log(`\n${C.ok}Push is READY.${C.off}\n`);
  process.exit(0);
})();
