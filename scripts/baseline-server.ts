import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {legacy} from '../tests/support/legacy';
const client=await legacy();
const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:4173,strictPort:true},plugins:[react(),{name:'baseline-test-host',enforce:'pre',transform(code,id){if(id.endsWith('globals.css'))return code.replace('@import "tailwindcss";','');},transformIndexHtml:{order:'pre',handler(html){return html.replace('/frontend/main.tsx','/baseline/main.tsx');}},configureServer(s){s.middlewares.use('/api/data',async(req,res)=>{try{const url=new URL(req.url!,'http://localhost');const chunks=[];for await(const c of req)chunks.push(c);const response=req.method==='POST'?await client.request(JSON.parse(Buffer.concat(chunks).toString())):await client.request(undefined,url.searchParams.get('date')??'');res.statusCode=response.status;res.setHeader('content-type','application/json');res.end(await response.text());}catch{res.statusCode=500;res.end('{"error":"Test host failure"}');}});}}]});
await server.listen();console.log('Disposable baseline test app: http://127.0.0.1:4173');
