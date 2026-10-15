// Runs every migration in an in-memory Postgres and tries to break the row-level security as a second user.
// Usage: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
// Every migration in order, exactly as Supabase would run them.
const dir = process.argv[2];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
// Minimal stand-ins for Supabase's auth schema and roles.
await db.exec(`
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role authenticated; create role anon;
grant usage on schema public to authenticated;
`);
for (const f of files) await db.exec(fs.readFileSync(`${dir}/${f}`, 'utf8'));
await db.exec(`grant select, insert, update, delete on all tables in schema public to authenticated;`);
const U1='11111111-1111-1111-1111-111111111111', U2='22222222-2222-2222-2222-222222222222';
await db.exec(`insert into auth.users values ('${U1}'),('${U2}');`);
const as = async (uid, q) => { await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`); try { return await db.query(q); } finally { await db.exec('reset role;'); } };
let pass=0, fail=0; const ok=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL', m); } };
const tryq = async (uid,q) => { try { await as(uid,q); return 'ok'; } catch(e) { return 'err: '+e.message.split('\n')[0]; } };
// profiles created by trigger
ok((await db.query('select count(*)::int c from public.profiles')).rows[0].c===2,'profiles auto-created');
// user 1 sets up
await as(U1,`insert into public.strategies (id,user_id,name,kind,default_risk_pct,checklist) values ('aaaaaaaa-0000-0000-0000-000000000001','${U1}','NY open','rules',1,'{a,b}')`);
await as(U1,`insert into public.accounts (id,user_id,type,size,targets,max_drawdown_pct,daily_loss_pct) values ('bbbbbbbb-0000-0000-0000-000000000001','${U1}','challenge',100000,'{8,5}',10,5)`);
await as(U1,`insert into public.trades (user_id,account_id,strategy_id,strategy_version,entry_at,instrument,direction,planned,rules_met,exit,risk_pct,default_risk_pct,result_usd,r) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,now(),'NAS100','long',true,true,'as_planned',1,1,1000,1)`);
ok((await as(U1,'select count(*)::int c from public.trades')).rows[0].c===1,'owner sees own trade');
ok((await as(U2,'select count(*)::int c from public.trades')).rows[0].c===0,'other user sees no trades');
ok((await as(U2,'select count(*)::int c from public.accounts')).rows[0].c===0,'other user sees no accounts');
ok((await as(U2,'select count(*)::int c from public.profiles')).rows[0].c===1,'other user sees only own profile');
// user 2 tries to write into user 1's data
ok((await tryq(U2,`insert into public.trades (user_id,account_id,strategy_id,strategy_version,entry_at,instrument,direction,planned,rules_met,exit,risk_pct,default_risk_pct,result_usd,r) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,now(),'X','long',true,true,'as_planned',1,1,1,1)`)).startsWith('err'),'cannot insert a trade as someone else');
ok((await tryq(U2,`insert into public.trades (user_id,account_id,strategy_id,strategy_version,entry_at,instrument,direction,planned,rules_met,exit,risk_pct,default_risk_pct,result_usd,r) values ('${U2}','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,now(),'X','long',true,true,'as_planned',1,1,1,1)`)).startsWith('err'),"cannot attach own trade to someone else's account");
await as(U2,`update public.trades set r=99`); ok((await db.query('select max(r)::float m from public.trades')).rows[0].m===1,"cannot update someone else's trade");
await as(U2,`delete from public.accounts`); ok((await db.query('select count(*)::int c from public.accounts')).rows[0].c===1,"cannot delete someone else's account");
// health-data consent gate
ok((await tryq(U1,`insert into public.checkins (user_id,day,sleep_hours,usual_schedule,carrying,water,feeling,sharpness) values ('${U1}',current_date,7,true,'nothing',true,'calm',7)`)).startsWith('err'),'check-in blocked before consent');
ok((await tryq(U1,`insert into public.trades (user_id,account_id,strategy_id,strategy_version,entry_at,instrument,direction,planned,rules_met,exit,risk_pct,default_risk_pct,result_usd,r,sleep_hours) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,now(),'NAS100','long',true,true,'as_planned',1,1,1,1,7)`)).startsWith('err'),'trade cannot carry check-in data before consent');
await as(U1,`update public.profiles set health_consent_at=now() where id='${U1}'`);
ok((await tryq(U1,`insert into public.checkins (user_id,day,sleep_hours,usual_schedule,carrying,water,feeling,sharpness) values ('${U1}',current_date,7,true,'nothing',true,'calm',7)`))==='ok','check-in allowed after consent');
ok((await tryq(U1,`insert into public.checkins (user_id,day,sleep_hours,usual_schedule,carrying,water,sharpness) values ('${U1}',current_date-1,7,true,'nothing',true,7)`)).startsWith('err'),'check-in needs a feeling');
ok((await tryq(U1,`insert into public.trades (user_id,account_id,strategy_id,strategy_version,entry_at,instrument,direction,planned,rules_met,exit,risk_pct,default_risk_pct,result_usd,r,sleep_hours,feeling) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,now(),'NAS100','long',true,true,'as_planned',1,1,1,1,7,'calm')`))==='ok','trade carries check-in data after consent');
ok((await as(U2,'select count(*)::int c from public.checkins')).rows[0].c===0,"other user can't read check-ins");
await as(U1,`insert into public.no_trade_days (user_id,account_id,day,reason) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001',current_date,'no_setup')`);
ok((await tryq(U1,`insert into public.no_trade_days (user_id,account_id,day,reason) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001',current_date,'rest_day')`)).startsWith('err'),'one no-trade day per account per day');
ok((await tryq(U1,`insert into public.skipped_setups (user_id,account_id,reason) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001','fear')`))==='ok','owner can log a skipped setup');
ok((await tryq(U1,`insert into public.day_ratings (user_id,account_id,day,rating) values ('${U1}','bbbbbbbb-0000-0000-0000-000000000001',current_date,'A')`))==='ok','owner can rate a day');
ok((await tryq(U2,`insert into public.skipped_setups (user_id,account_id,reason) values ('${U2}','bbbbbbbb-0000-0000-0000-000000000001','fear')`)).startsWith('err'),"cannot log a skipped setup on someone else's account");
// anonymous gets nothing
ok((await tryq('',`select * from public.trades`)).startsWith('err')||(await as('', 'select count(*)::int c from public.trades')).rows[0].c===0,'no auth sees nothing');
// deleting an account removes its trades
await as(U1,`delete from public.accounts where id='bbbbbbbb-0000-0000-0000-000000000001'`);
ok((await db.query('select count(*)::int c from public.trades')).rows[0].c===0,'account delete cascades to trades');
// constraint checks
ok((await tryq(U1,`insert into public.strategies (user_id,name,kind,default_risk_pct) values ('${U1}','x','rules',50)`)).startsWith('err'),'risk over 10% rejected');
console.log(`pass ${pass} fail ${fail}`);
