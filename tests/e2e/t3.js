const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{
  const ctx=await chromium.launchPersistentContext('/tmp/h/prof'+Date.now(),{executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const URL='http://localhost:8099/ui.html';
  const mk=(id,sql)=>({id,name:'Query',sql,data:[],currentPage:1,totalRows:0,lastSql:'',statusText:'',siteKey:'thai_binh'});
  // dữ liệu kiểu v1.1.2: có sessionsBySite (cả 2 site) + tabsBySite cũ, KHÔNG có lastSiteKey
  const old={sessionsBySite:{hung_yen:[{id:'s_hy',name:'HY',tabs:[mk('a','HY_OLD')],activeTabId:'a'}],thai_binh:[{id:'s_tb',name:'Phiên TBH',tabs:[mk('b','TBH_OLD_1'),mk('c','TBH_OLD_2')],activeTabId:'c'}]},currentSessionIdBySite:{hung_yen:'s_hy',thai_binh:'s_tb'},tabsBySite:{hung_yen:[],thai_binh:[]}};
  const p0=await ctx.newPage(); await p0.goto('http://localhost:8099/vs/loader.js'); await p0.evaluate(o=>localStorage.setItem('__fake_chrome_storage__',JSON.stringify(o)),old); await p0.close();
  const p=await ctx.newPage(); const logs=[]; p.on('console',m=>logs.push(m.text().slice(0,200)));
  await p.goto(URL); await p.waitForTimeout(2500);
  await p.evaluate(()=>document.querySelector('.site-item[data-site="thai_binh"]').click()); await p.waitForTimeout(3000);
  console.log(await p.evaluate(()=>({title:document.title,tb:sessionsBySite.thai_binh.map(s=>s.name+'['+s.tabs.map(t=>t.sql).join('|')+']')})));
  console.log(logs.filter(l=>l.includes('[STORAGE]')).join('\n'));
  await ctx.close();
})();
