import {randomUUID} from 'node:crypto';
const defaults={
 'Prairie Sky FC':'info@prairieskyfc.ca',
 'Dynamo Soccer Club':'winnipegdynamosc@gmail.com',
 'Youth Football Club':'yfcsocceracademy@gmail.com',
 'Birds Academy':'birdsacademywpg@gmail.com',
 'Green Strikers FC':'talha.kalia5778@gmail.com',
 'Shakhtar Academy Winnipeg':'mzhdanov@shakhtarwinnipeg.com'
};
// Private configuration: club addresses and registration payloads never appear in public APIs.
export function setupClubMail({db,clubs,InputError,email,env=process.env,send=fetch,startWorker=true}){
 const outboxSchema=`CREATE TABLE IF NOT EXISTS league_mail_outbox(id TEXT PRIMARY KEY,entryId TEXT NOT NULL REFERENCES league_entries(id),kind TEXT NOT NULL DEFAULT 'club' CHECK(kind IN ('club','parent')),club TEXT NOT NULL,recipient TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,nextAttempt INTEGER NOT NULL DEFAULT 0,firstAttempt INTEGER,createdAt TEXT NOT NULL,acceptedAt TEXT,providerId TEXT,error TEXT NOT NULL DEFAULT '',UNIQUE(entryId,kind));`;
 db.exec('CREATE TABLE IF NOT EXISTS league_club_contacts(club TEXT PRIMARY KEY,email TEXT NOT NULL);');
 const columns=db.prepare('PRAGMA table_info(league_mail_outbox)').all();
 if(columns.length&&!columns.some(c=>c.name==='kind')){
  db.exec('BEGIN IMMEDIATE');try{
   db.exec('ALTER TABLE league_mail_outbox RENAME TO league_mail_outbox_old;');db.exec(outboxSchema);
   db.exec(`INSERT INTO league_mail_outbox(id,entryId,kind,club,recipient,payload,status,attempts,nextAttempt,firstAttempt,createdAt,acceptedAt,providerId,error) SELECT id,entryId,'club',club,recipient,payload,status,attempts,nextAttempt,firstAttempt,createdAt,acceptedAt,providerId,error FROM league_mail_outbox_old; DROP TABLE league_mail_outbox_old;`);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
 }else db.exec(outboxSchema);
 for(const club of clubs)db.prepare('INSERT OR IGNORE INTO league_club_contacts VALUES(?,?)').run(club,defaults[club]||'');
 const configured=()=>Boolean(env.RESEND_API_KEY&&env.CLUB_MAIL_FROM);
 const forEntry=(id,kind='club')=>db.prepare('SELECT id,status,recipient,acceptedAt,attempts,error FROM league_mail_outbox WHERE entryId=? AND kind=?').get(id,kind)||null;
 function enqueue({id,firstName,lastName,birthYear,team,account,contactPhone,consent,signedAt}){
  const recipient=db.prepare('SELECT email FROM league_club_contacts WHERE club=?').get(team.club)?.email||'';
  const content=[`New Super Junior League player registration`, `Registration ID: ${id}`,`Player: ${firstName} ${lastName}`,`Birth year: ${birthYear}`,`Club: ${team.club}`,`Team: ${team.name}`,`Parent / guardian: ${account.name}`,`Parent email: ${account.email}`,`Parent phone: ${contactPhone}`,`Photos / video: ${consent.media?'YES':'NO'}`,`Interviews: ${consent.interviews?'YES':'NO'}`,`Public statistics: ${consent.publicStats?'YES':'NO'}`,`Submitted: ${signedAt}`, '', 'Status: awaiting league roster review. This notification does not confirm eligibility or roster approval.', 'Contact the parent directly to confirm the club roster. Registration details were shared with the selected club by the parent; keep them private and use them only for registration and team administration.'].join('\n');
  const payload={subject:`SJL registration — ${team.name}`,text:content,reply_to:account.email};
  const insert=db.prepare('INSERT INTO league_mail_outbox(id,entryId,kind,club,recipient,payload,createdAt) VALUES(?,?,?,?,?,?,?)');
  insert.run(randomUUID(),id,'club',team.club,recipient,JSON.stringify(payload),signedAt);
  const parentText=[`Hi ${account.name},`, '', 'We have received your Super Junior League registration.', `Player: ${firstName} ${lastName}`, `Birth year: ${birthYear}`, `Club: ${team.club}`, `Team: ${team.name}`, `Season: 2026/27`, `Registration ID: ${id}`, '', 'Status: awaiting league roster review. This confirms receipt of your application, not approval or eligibility.', 'Your selected club has been queued to receive your registration and contact details. The league administrator will review the roster and link official player statistics.', '', `Photos / video permission: ${consent.media?'YES':'NO'}`, `Interview permission: ${consent.interviews?'YES':'NO'}`, `Public statistics permission: ${consent.publicStats?'YES':'NO'}`, '', 'Sign in to your parent account on the league website to view the player profile, team schedule, status and confirmed statistics. You can also change your media permissions there.', 'If any registration details are incorrect, contact your selected club or the league organizer.'].join('\n');
  insert.run(randomUUID(),id,'parent',team.club,account.email,JSON.stringify({subject:`SJL registration received — ${firstName} ${lastName}`,text:parentText,...(recipient?{reply_to:recipient}:{})}),signedAt);
 }
 let running=false;
 async function flush(){
  if(running||!configured())return;running=true;
  try{
   const rows=db.prepare("SELECT * FROM league_mail_outbox WHERE status IN ('queued','failed') AND nextAttempt<=? ORDER BY createdAt LIMIT 10").all(Date.now());
   for(const row of rows){
    if(!row.recipient){db.prepare("UPDATE league_mail_outbox SET status='blocked',error='Club email is not configured.' WHERE id=?").run(row.id);continue}
    // Resend retains idempotency keys for 24 hours. Never retry an uncertain send after that window.
    if(row.firstAttempt&&Date.now()-row.firstAttempt>23*60*60*1000){db.prepare("UPDATE league_mail_outbox SET status='needs_review',error='Retry window expired. Check provider logs before sending again.' WHERE id=?").run(row.id);continue}
    db.prepare('UPDATE league_mail_outbox SET attempts=attempts+1,firstAttempt=COALESCE(firstAttempt,?) WHERE id=?').run(Date.now(),row.id);
    try{
     const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'sjl-registration-'+row.id},body:JSON.stringify({...JSON.parse(row.payload),from:env.CLUB_MAIL_FROM,to:[row.recipient]}),signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw Error('Email provider rejected the request (HTTP '+response.status+').');
     const result=await response.json();if(typeof result.id!=='string'||!result.id)throw Error('Email provider returned no message ID.');
     db.prepare("UPDATE league_mail_outbox SET status='accepted',acceptedAt=?,providerId=?,error='' WHERE id=?").run(new Date().toISOString(),result.id,row.id);
    }catch(error){const reason=error.name==='TimeoutError'?'Email provider request timed out.':error.message.startsWith('Email provider')?error.message:'Email provider connection failed.';db.prepare("UPDATE league_mail_outbox SET status='failed',error=?,nextAttempt=? WHERE id=?").run(reason,Date.now()+Math.min(3600000,60000*2**Math.min(row.attempts,6)),row.id)}
   }
  }finally{running=false}
 }
 function updateContact(club,value){if(!clubs.includes(club))throw new InputError('Choose a league club.');const address=email(value).toLowerCase();if(!address)throw new InputError('Club email is required.');db.prepare('UPDATE league_club_contacts SET email=? WHERE club=?').run(address,club);db.prepare("UPDATE league_mail_outbox SET recipient=?,status='queued',nextAttempt=0,error='' WHERE kind='club' AND club=? AND attempts=0 AND status IN ('queued','blocked')").run(address,club)}
 function retry(id){const row=db.prepare('SELECT * FROM league_mail_outbox WHERE id=?').get(id);if(!row)throw new InputError('Notification not found.',404);if(!['queued','failed','blocked'].includes(row.status))throw new InputError('This notification cannot be retried. Check its status.',409);db.prepare("UPDATE league_mail_outbox SET status='queued',nextAttempt=0 WHERE id=?").run(id)}
 if(startWorker){setInterval(()=>{void flush().catch(()=>console.error('Club email queue could not be processed.'))},60000).unref();void flush().catch(()=>console.error('Club email queue could not be processed.'))}
 return{enqueue,flush,forEntry,retry,updateContact,overview:()=>({configured:configured(),contacts:db.prepare('SELECT * FROM league_club_contacts ORDER BY club').all()})};
}
