const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{
  const ctx=await chromium.launchPersistentContext('/tmp/h/prof'+Date.now(),{executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const URL='http://localhost:8099/ui.html';
  const mk=(id,sql,site)=>({id,name:'Q',sql,data:[],currentPage:1,totalRows:0,lastSql:'',statusText:'',siteKey:site});
  const old={sessionsBySite:{hung_yen:[{id:'s_hy',name:'HY',tabs:[mk('a','HY_OLD','hung_yen')],activeTabId:'a'},{id:'s_hy2',name:'HY2',tabs:[mk('a2','HY2_OLD','hung_yen')],activeTabId:'a2'}],thai_binh:[{id:'s_tb',name:'TB1',tabs:[mk('b','TB1_A','thai_binh'),mk('c','TB1_B','thai_binh')],activeTabId:'c'},{id:'s_tb2',name:'TB2',tabs:[mk('d','TB2_A','thai_binh')],activeTabId:'d'}]},currentSessionIdBySite:{hung_yen:'s_hy',thai_binh:'s_tb'}};
  const p0=await ctx.newPage(); await p0.goto('http://localhost:8099/vs/loader.js'); await p0.evaluate(o=>localStorage.setItem('__fake_chrome_storage__',JSON.stringify(o)),old); await p0.close();
  const snap=p=>p.evaluate(()=>({site:currentSiteKey,hy:sessionsBySite.hung_yen.map(s=>s.name+'['+s.tabs.map(t=>t.sql).join('|')+']').join(' '),tb:sessionsBySite.thai_binh.map(s=>s.name+'['+s.tabs.map(t=>t.sql).join('|')+']').join(' ')}));
  const site=(p,k)=>p.evaluate(k=>document.querySelector(`.site-item[data-site="${k}"]`).click(),k);
  let p=await ctx.newPage(); await p.goto(URL); await p.waitForTimeout(2000);
  for(const k of ['thai_binh','hung_yen','thai_binh','hung_yen','thai_binh']){await site(p,k);await p.waitForTimeout(400);}
  await p.waitForTimeout(2500); console.log('1',JSON.stringify(await snap(p))); await p.close();
  p=await ctx.newPage(); await p.goto(URL); await p.waitForTimeout(2500);
  console.log('2',JSON.stringify(await snap(p)));        // mở lại: phải vào TBH
  await site(p,'hung_yen'); await p.waitForTimeout(400); await site(p,'thai_binh'); await p.waitForTimeout(3000);
  console.log('3',JSON.stringify(await snap(p)));
  await ctx.close();
})();
