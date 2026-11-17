// Fake Monaco for harness
(function(){
  function mkModel(v){let val=v||'';const m={getValue:()=>val,setValue:x=>{val=x;(m._cb||[]).forEach(f=>f())},dispose(){},getLineCount:()=>val.split('\n').length,getFullModelRange:()=>({}),getValueInRange:()=>'',onDidChangeContent(f){(m._cb=m._cb||[]).push(f);return{dispose(){}}},getLanguageId:()=>'sql',pushEditOperations(){},setEOL(){},getOffsetAt:()=>0};return m;}
  const lax=(o)=>new Proxy(o,{get:(t,k)=>k in t?t[k]:(k==='then'?undefined:()=>({}))});
  window.monaco={
    KeyMod:{CtrlCmd:2048,Alt:512,Shift:1024},KeyCode:new Proxy({}, {get:()=>1}),
    Range:function(){}, languages:lax({}),
    editor:{
      createModel:(v)=>mkModel(v),
      create:()=>{let model=mkModel('');const cbs=[];const ed=lax({
        getValue:()=>model.getValue(),setValue:v=>{model.setValue(v)},getModel:()=>model,setModel:m=>{model=m},
        onDidChangeModelContent:(f)=>{cbs.push(f);return{dispose(){}}},
        saveViewState:()=>({}),restoreViewState:()=>{},layout:()=>{},focus:()=>{},addCommand:()=>{},
        getSelection:()=>({isEmpty:()=>true}),updateOptions:()=>{},getPosition:()=>({lineNumber:1,column:1}),
        addAction:()=>{},onDidFocusEditorText:()=>({dispose(){}}),onDidChangeCursorSelection:()=>({dispose(){}}),
        getContainerDomNode:()=>document.createElement('div'),
      });window.__ed=ed;return ed;},
      setTheme(){},defineTheme(){},setModelLanguage(){}
    }
  };
  window.require=function(deps,cb){setTimeout(()=>cb(window.monaco,{format:(s)=>s}),0)};
  window.require.config=function(){};
})();
