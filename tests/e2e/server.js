const http=require('http'),fs=require('fs'),path=require('path');
const root='/home/claude/work/query_tool/code';
http.createServer((q,r)=>{
  let u=q.url.split('?')[0]; if(u==='/')u='/ui.html';
  if(u==='/__inject.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync('/tmp/h/inject.js'))}
  if(u==='/vs/loader.js'){r.setHeader('content-type','text/javascript');return r.end(fs.readFileSync('/tmp/h/loader.js'))}
  const p=path.join(root,u); if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){r.statusCode=404;return r.end('nf')}
  const ext=path.extname(p); r.setHeader('content-type',{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json'}[ext]||'application/octet-stream');
  let b=fs.readFileSync(p);
  if(u==='/ui.html'){b=Buffer.from(b.toString('utf8').replace('<head>','<head><script src="/__inject.js"></script>'))}
  r.end(b);
}).listen(8099,()=>console.log('up'));
