// Run locally only. Copies an allowlist; never copies deployment IDs, Git history,
// SQL/data migrations, screenshots, exports, or personal seed programs.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const source=resolve(process.argv[2]??'../work/site');
const target=resolve('baseline');
function write(path,text){mkdirSync(dirname(resolve(target,path)),{recursive:true});writeFileSync(resolve(target,path),text);}
for(const path of ['app/page.tsx','app/globals.css','app/layout.tsx','db/schema.ts','worker/database-backup.ts','worker/backup-retention.ts','tests/backup-retention.test.mjs']){mkdirSync(dirname(resolve(target,path)),{recursive:true});copyFileSync(resolve(source,path),resolve(target,path));}
let route=readFileSync(resolve(source,'app/api/data/route.ts'),'utf8');
route=route.replace(/const currentProgram = \[[\s\S]*?(?=function database\()/,'');
const start=route.indexOf('async function seedIfEmpty()');
const end=route.indexOf('async function finalizeExpiredDrafts(');
if(start<0||end<start)throw new Error('Unexpected source: review sanitization');
route=route.slice(0,start)+`async function seedIfEmpty() {\n  const db = database();\n  const existing = await db.prepare("SELECT COUNT(*) AS count FROM exercises").first<{ count: number }>();\n  if ((existing?.count ?? 0) > 0) return;\n  await db.batch(exerciseSeed.map((item) => db.prepare("INSERT INTO exercises (name, muscle, equipment) VALUES (?, ?, ?)").bind(...item)));\n}\n\n`+route.slice(end);
route=route.replace('    await importCurrentProgramIfMissing();\n','');
write('app/api/data/route.ts',route);
write('README.md','# Current application baseline\n\nSanitized snapshot of the current Cloudflare/D1 app. UI and API behavior are preserved. Personal plan and performance seeding is removed; the public baseline seeds only the common exercise catalog. Original data and deployment remain in the original private workspace.\n\nThe contract test harness executes this route with disposable SQLite. Set BASELINE_SOURCE to the original app directory to run the same tests against the original route (automatic seed/import hooks disabled in the test harness only). No test connects to the live app.\n');
