// fake chrome API persisted in localStorage (mô phỏng chrome.storage.local bền vững qua các lần mở)
(function(){
  const KEY='__fake_chrome_storage__';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return{}}};
  const save=o=>localStorage.setItem(KEY,JSON.stringify(o));
  const area={
    get(keys,cb){const s=load();let out={};if(keys==null)out=s;else if(typeof keys==='string')out[keys]=s[keys];else if(Array.isArray(keys))keys.forEach(k=>{if(k in s)out[k]=s[k]});else Object.keys(keys).forEach(k=>out[k]=k in s?s[k]:keys[k]);
      const r=JSON.parse(JSON.stringify(out));if(cb){setTimeout(()=>cb(r),5);return}return Promise.resolve(r)},
    set(o,cb){const s=load();Object.assign(s,JSON.parse(JSON.stringify(o)));save(s);if(cb){setTimeout(cb,5);return}return Promise.resolve()},
    remove(k,cb){const s=load();[].concat(k).forEach(x=>delete s[x]);save(s);if(cb)setTimeout(cb,5);return Promise.resolve()},
  };
  window.chrome={
    storage:{local:area,onChanged:{addListener(){}}},
    runtime:{id:'x',getURL:p=>'/'+p,lastError:undefined,
      sendMessage(msg,cb){const r={success:true};if(cb)setTimeout(()=>cb(r),5);return Promise.resolve(r)},
      onMessage:{addListener(){}},getManifest:()=>({version:'1.2.1'})},
    tabs:{query:()=>Promise.resolve([]),sendMessage(){},create(){}},
  };
})();
