import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Only this adapter knows D1. Contract scenarios depend on Request/Response.
// SQLite runs the actual queries; we do not mock query text or canned responses.
export async function legacy(){
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 class Statement{
  constructor(readonly sql:string,readonly args:any[]=[]){ }
  bind(...args:any[]){return new Statement(this.sql,args);}
  async all(){return {results:db.prepare(this.sql).all(...this.args)};}
  async first(){return db.prepare(this.sql).get(...this.args)??null;}
  async run(){return db.prepare(this.sql).run(...this.args);}
 }
 const binding={prepare:(sql:string)=>new Statement(sql),batch:async(statements:Statement[])=>{db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}};
 const path=resolve(process.env.BASELINE_SOURCE??'baseline','app/api/data/route.ts');
 const source=(await readFile(path,'utf8')).replace(/\s*await (?:seedIfEmpty|importCurrentProgramIfMissing)\(\);/g,'');
 const result=await build({stdin:{contents:source,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'d1-boundary',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const env = globalThis.__testD1Environment;',loader:'js'}));}}]});
 const global=globalThis as any;global.__testD1Environment={DB:binding};
 const module={exports:{} as {GET:(r:Request)=>Promise<Response>;POST:(r:Request)=>Promise<Response>}};
 new Function('module','exports',result.outputFiles[0].text)(module,module.exports);delete global.__testD1Environment;
 const request=async(payload?:unknown,date='2040-06-10')=>payload===undefined?module.exports.GET(new Request(`http://test/api/data?date=${date}`)):module.exports.POST(new Request('http://test/api/data',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));
 await request(); // Initialize only the disposable schema.
 db.prepare('INSERT INTO exercises (id,name,muscle,equipment) VALUES (?,?,?,?)').run(1,'Synthetic Press','Chest','Machine');
 db.prepare('INSERT INTO exercises (id,name,muscle,equipment) VALUES (?,?,?,?)').run(2,'Synthetic Row','Back','Cable');
 return {request,close:()=>db.close()};
}
