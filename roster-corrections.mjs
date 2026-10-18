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
