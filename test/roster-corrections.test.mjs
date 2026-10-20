import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {applyRosterCorrections} from '../roster-corrections.mjs';
test('targeted correction moves linked profile and statistics together, preserves totals and runs once',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE players(id TEXT PRIMARY KEY,club TEXT,ageGroup TEXT,version INTEGER,goals INTEGER);CREATE TABLE league_teams(id TEXT PRIMARY KEY,club TEXT,ageGroup TEXT,active INTEGER);CREATE TABLE league_entries(id TEXT PRIMARY KEY,statsPlayerId TEXT,teamId TEXT,status TEXT,consent TEXT);
 INSERT INTO league_teams VALUES('old','Prairie Sky FC','U10',1),('new','Prairie Sky FC','U13',1);
 INSERT INTO players VALUES('eef60355-811d-49c1-9bbc-de19f22c954a','Prairie Sky FC','U10',3,7),('other','Prairie Sky FC','U10',1,0);
 INSERT INTO league_entries VALUES('entry','eef60355-811d-49c1-9bbc-de19f22c954a','old','approved','unchanged');`);
 applyRosterCorrections(db);applyRosterCorrections(db);
 assert.deepEqual({...db.prepare("SELECT * FROM league_entries").get()},{id:'entry',statsPlayerId:'eef60355-811d-49c1-9bbc-de19f22c954a',teamId:'new',status:'approved',consent:'unchanged'});
 assert.deepEqual({...db.prepare("SELECT ageGroup,version,goals FROM players WHERE id<> 'other'").get()},{ageGroup:'U13',version:4,goals:7});
 assert.equal(db.prepare("SELECT ageGroup FROM players WHERE id='other'").get().ageGroup,'U10');db.close();
});

test('organizer transfer approves a declined entry once without changing consent or guardian, and rejects ambiguous matches',async()=>{
 const {applyOrganizerRosterCorrection}=await import('../roster-corrections.mjs');
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE players(id TEXT PRIMARY KEY,name TEXT,club TEXT,ageGroup TEXT,goals INTEGER,assists INTEGER,cleanSheets INTEGER,version INTEGER);CREATE TABLE parent_accounts(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE league_teams(id TEXT PRIMARY KEY,club TEXT,ageGroup TEXT,name TEXT,active INTEGER);CREATE TABLE league_entries(id TEXT PRIMARY KEY,parentId TEXT,firstName TEXT,lastName TEXT,birthYear INTEGER,teamId TEXT,status TEXT,statsPlayerId TEXT,consent TEXT,reviewNote TEXT,reviewedAt TEXT);
 INSERT INTO parent_accounts VALUES('parent','Test Guardian');
 INSERT INTO league_teams VALUES('source','Prairie Sky FC','U10','Prairie Sky FC U10',1),('destination','Green Strikers FC','U10','Green Strikers FC U10',1);
 INSERT INTO league_entries VALUES('entry','parent','Test','Junior',2015,'source','rejected',NULL,'original-consent','Original decline reason','old');`);
 const correction={key:'test-transfer',firstName:'Test',lastName:'Junior',birthYear:2015,guardianName:'Test Guardian',sourceClub:'Prairie Sky FC',sourceAgeGroup:'U10',targetClub:'Green Strikers FC',targetAgeGroup:'U10'};
 assert.throws(()=>applyOrganizerRosterCorrection(db,{...correction,guardianName:'Wrong Guardian'}));assert.equal(db.prepare('SELECT count(*) n FROM players').get().n,0);
 applyOrganizerRosterCorrection(db,correction);applyOrganizerRosterCorrection(db,correction);
 const entry=db.prepare('SELECT * FROM league_entries').get();assert.equal(entry.teamId,'destination');assert.equal(entry.status,'approved');assert.equal(entry.parentId,'parent');assert.equal(entry.consent,'original-consent');
 const stats=db.prepare('SELECT * FROM players').all();assert.equal(stats.length,1);assert.equal(stats[0].id,entry.statsPlayerId);assert.equal(stats[0].club,'Green Strikers FC');assert.equal(stats[0].ageGroup,'U10');assert.equal(stats[0].goals,0);
 const audit=JSON.parse(db.prepare('SELECT value FROM meta').get().value);assert.equal(audit.previousReviewNote,'Original decline reason');assert.equal(audit.previousStatus,'rejected');db.close();
});

test('pending division correction is exact, audited and idempotent without approving or changing consent',async()=>{
 const {applyPendingDivisionCorrection}=await import('../roster-corrections.mjs');
 const {createHash}=await import('node:crypto');
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE players(id TEXT,name TEXT,club TEXT,ageGroup TEXT,version INTEGER,goals INTEGER);CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE parent_accounts(id TEXT,name TEXT);CREATE TABLE league_teams(id TEXT,club TEXT,ageGroup TEXT,active INTEGER);CREATE TABLE league_entries(id TEXT,parentId TEXT,firstName TEXT,lastName TEXT,birthYear INTEGER,teamId TEXT,status TEXT,statsPlayerId TEXT,consent TEXT);CREATE TABLE league_entry_edits(id TEXT,entryId TEXT,action TEXT,previous TEXT,createdAt TEXT);
 INSERT INTO parent_accounts VALUES('parent','Test Guardian');
 INSERT INTO league_teams VALUES('old','Shakhtar Academy Winnipeg','U10',1),('new','Shakhtar Academy Winnipeg','U13',1);
 INSERT INTO league_entries VALUES('entry','parent','Test','Junior',2014,'old','pending',NULL,'original');`);
 const identityHash=createHash('sha256').update(JSON.stringify(['test','junior',2014,'test guardian'])).digest('hex');
 assert.equal(applyPendingDivisionCorrection(db,'wrong'),false);
 assert.equal(applyPendingDivisionCorrection(db,identityHash),true);
 assert.equal(applyPendingDivisionCorrection(db,identityHash),false);
 const entry=db.prepare('SELECT * FROM league_entries').get();
 assert.equal(entry.teamId,'new');assert.equal(entry.status,'pending');assert.equal(entry.statsPlayerId,null);assert.equal(entry.consent,'original');assert.equal(entry.parentId,'parent');
 assert.equal(db.prepare('SELECT count(*) n FROM league_entry_edits').get().n,1);
 db.exec("DELETE FROM meta;UPDATE league_entries SET teamId='old',status='approved',statsPlayerId='stats';INSERT INTO players VALUES('stats','Test Junior','Shakhtar Academy Winnipeg','U10',3,7);");
 assert.equal(applyPendingDivisionCorrection(db,identityHash),true);
 assert.equal(db.prepare('SELECT status FROM league_entries').get().status,'approved');
 const stats=db.prepare('SELECT * FROM players').get();assert.equal(stats.ageGroup,'U13');assert.equal(stats.goals,7);assert.equal(stats.version,4);db.close();
});
