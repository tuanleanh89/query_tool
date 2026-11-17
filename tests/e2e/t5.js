const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async()=>{
  const ctx=await chromium.launchPersistentContext('/tmp/h/prof'+Date.now(),{executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const p=await ctx.newPage(); await p.goto('http://localhost:8099/ui.html'); await p.waitForTimeout(2000);
  const r=await p.evaluate(async()=>{ lastSql='SELECT 1 FROM dual'; const orig=SqlUtils.analyze; SqlUtils.analyze=()=>{throw new Error('boom')}; await executeWithPagination(); SqlUtils.analyze=orig; return {disabled:document.getElementById('btnExecute').disabled,status:document.getElementById('status').innerText}});
  console.log(r); await ctx.close();
})();
