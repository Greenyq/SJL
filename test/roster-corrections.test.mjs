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
