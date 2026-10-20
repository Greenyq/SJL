import { createHash, randomUUID } from 'node:crypto';
// Organizer-requested correction, 2026-10-18. Match the verified stable player
// ID so no other registration with a similar name can be moved.
export function applyRosterCorrections(db) {
 const key='roster-correction-2026-10-18-u13';
 if(db.prepare('SELECT value FROM meta WHERE key=?').get(key))return;
 const id='eef60355-811d-49c1-9bbc-de19f22c954a';
 const player=db.prepare('SELECT * FROM players WHERE id=?').get(id);
 if(!player)return;
 const targets=db.prepare("SELECT id FROM league_teams WHERE club='Prairie Sky FC' AND ageGroup='U13' AND active=1").all();
 const entries=db.prepare('SELECT e.id,t.club,t.ageGroup FROM league_entries e JOIN league_teams t ON t.id=e.teamId WHERE e.statsPlayerId=?').all(id);
 if(player.club!=='Prairie Sky FC'||player.ageGroup!=='U10'||targets.length!==1||entries.length!==1||entries[0].club!==player.club||entries[0].ageGroup!=='U10')throw new Error('Roster correction requires review: unexpected source or destination.');
 db.exec('BEGIN IMMEDIATE');
 try {
  db.prepare('UPDATE league_entries SET teamId=? WHERE id=?').run(targets[0].id,entries[0].id);
  db.prepare("UPDATE players SET ageGroup='U13',version=version+1 WHERE id=?").run(id);
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(key,JSON.stringify({entryId:entries[0].id,playerId:id,from:player.ageGroup,to:'U13',appliedAt:new Date().toISOString()}));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}

// One-time, organizer-authorized transfers are supplied privately in the
// service environment; registration and guardian details stay out of Git.
export function applyOrganizerRosterCorrection(db, correction) {
 if(!correction)return;
 const {key,firstName,lastName,birthYear,guardianName,sourceClub,sourceAgeGroup,targetClub,targetAgeGroup}=correction;
 if(![key,firstName,lastName,guardianName,sourceClub,sourceAgeGroup,targetClub,targetAgeGroup].every(v=>typeof v==='string'&&v.trim())||!Number.isInteger(birthYear)||!['U10','U13'].includes(targetAgeGroup))throw new Error('Invalid organizer roster correction.');
 const marker='organizer-roster:'+key;
 if(db.prepare('SELECT value FROM meta WHERE key=?').get(marker))return;
 db.exec('BEGIN IMMEDIATE');
 try {
  const entries=db.prepare(`SELECT e.*,t.club,t.ageGroup FROM league_entries e JOIN league_teams t ON t.id=e.teamId JOIN parent_accounts a ON a.id=e.parentId WHERE lower(e.firstName)=lower(?) AND lower(e.lastName)=lower(?) AND e.birthYear=? AND lower(a.name)=lower(?) AND t.club=? AND t.ageGroup=?`).all(firstName,lastName,birthYear,guardianName,sourceClub,sourceAgeGroup);
  const teams=db.prepare('SELECT * FROM league_teams WHERE club=? AND ageGroup=? AND active=1').all(targetClub,targetAgeGroup);
  if(entries.length!==1||teams.length!==1||!['pending','rejected'].includes(entries[0].status))throw new Error('Organizer roster correction needs a unique unapproved registration and active destination.');
  const entry=entries[0],team=teams[0],name=entry.firstName+' '+entry.lastName;
  if(entry.statsPlayerId)throw new Error('Unapproved registration unexpectedly has linked statistics.');
  if(db.prepare('SELECT id FROM players WHERE lower(name)=lower(?) AND club=? AND ageGroup=?').get(name,team.club,team.ageGroup))throw new Error('Destination statistics record requires manual verification.');
  const statsId=randomUUID(),now=new Date().toISOString();
  db.prepare('INSERT INTO players VALUES(?,?,?,?,?,?,?,1)').run(statsId,name,team.club,team.ageGroup,0,0,0);
  db.prepare("UPDATE league_entries SET teamId=?,status='approved',statsPlayerId=?,reviewNote=?,reviewedAt=? WHERE id=?").run(team.id,statsId,'Registration corrected and approved by the organizer. '+team.name+'.',now,entry.id);
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run(marker,JSON.stringify({entryId:entry.id,fromTeamId:entry.teamId,toTeamId:team.id,previousStatus:entry.status,previousReviewNote:entry.reviewNote,previousReviewedAt:entry.reviewedAt,statsPlayerId:statsId,appliedAt:now}));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}

// A screenshot-verified pending registration correction. Keep the child's and
// guardian's identifying details out of source; require an exact identity hash.
export function applyPendingDivisionCorrection(db, identityHash='8364a3e2c36389f59a81fd1197934ff7ef8576594393097cdb462fe3eddfc147') {
 const key='pending-division-correction-20261020';
 if(db.prepare('SELECT value FROM meta WHERE key=?').get(key))return false;
 db.exec('BEGIN IMMEDIATE');
 try {
  const candidates=db.prepare(`SELECT e.*,a.name guardianName FROM league_entries e JOIN parent_accounts a ON a.id=e.parentId JOIN league_teams t ON t.id=e.teamId WHERE t.club='Shakhtar Academy Winnipeg' AND t.ageGroup='U10' AND e.status='pending' AND e.statsPlayerId IS NULL`).all();
  const matches=candidates.filter(e=>createHash('sha256').update(JSON.stringify([e.firstName.trim().toLowerCase(),e.lastName.trim().toLowerCase(),e.birthYear,e.guardianName.trim().toLowerCase()])).digest('hex')===identityHash);
  const targets=db.prepare("SELECT id FROM league_teams WHERE club='Shakhtar Academy Winnipeg' AND ageGroup='U13' AND active=1").all();
  if(matches.length!==1||targets.length!==1){db.exec('ROLLBACK');return false}
  const entry=matches[0],now=new Date().toISOString();
  db.prepare('UPDATE league_entries SET teamId=? WHERE id=?').run(targets[0].id,entry.id);
  db.prepare('INSERT INTO league_entry_edits VALUES(?,?,?,?,?)').run(randomUUID(),entry.id,'transfer',JSON.stringify({teamId:entry.teamId,status:entry.status,statsPlayerId:null}),now);
  db.prepare('INSERT INTO meta VALUES(?,?)').run(key,JSON.stringify({entryId:entry.id,fromTeamId:entry.teamId,toTeamId:targets[0].id,appliedAt:now}));
  db.exec('COMMIT');return true;
 }catch(error){db.exec('ROLLBACK');throw error}
}
