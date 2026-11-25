#!/usr/bin/env node
'use strict';
// Control-boundary regression: actual panel + bridge scripts with a simulated
// live.numbox feedback loop. This does not claim native audio or real Live UI QA.
// DEL/REV are the ROUTE page's knobs 4 and 5 (indices 19/20); the top-bar copies were removed in 1.0.5.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const panelSource=fs.readFileSync(path.join(root,'device/md.panel.js'),'utf8');
const bridgeSource=fs.readFileSync(path.join(root,'device/md.bridge.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'artifacts/machine-catalog.json'),'utf8'));
let checks=0;
function same(actual,expected,message){checks++;assert.deepEqual(JSON.parse(JSON.stringify(actual)),JSON.parse(JSON.stringify(expected)),message);}
function ok(value,message){checks++;assert.ok(value,message);}
function host(editor){
 let now=0,tasks=[],events=[],labels=[],panel,bridge;
 const controls=new Map();
 class Task{constructor(fn,scope){this.fn=fn;this.scope=scope;this.dead=false;}schedule(ms){this.due=now+ms;tasks.push(this);}cancel(){this.dead=true;}freepeer(){this.dead=true;}}
 function control(name){if(!controls.has(name))controls.set(name,{value:0,getvalueof(){return this.value;},message(method,value){this.value=value;events.push({type:'livewrite',name,method,value});if(method!=='set')bridge.control(name,value);}});return controls.get(name);}
 bridge={Task,max:{os:'macintosh',arch:'arm64'},patcher:{getnamed:control},post(){},notifyclients(){},outlet(outlet,args){args=Array.from(args);events.push({type:'bridge',outlet,args});if(outlet===1&&panel&&args[0]==='state')panel.state(args[1]);}};
 vm.createContext(bridge);vm.runInContext(bridgeSource,bridge,{filename:'md.bridge.js'});
 const graphics=new Proxy({text_measure:s=>[String(s).length*5,10],show_text:s=>labels.push(String(s))},{get:(o,k)=>k in o?o[k]:(()=>{})});
 const width=editor?1120:757,height=editor?250:169;
 panel={Task,mgraphics:graphics,box:{rect:[0,0,width,height]},jsarguments:['md.panel.js',editor?'editor':''],arrayfromargs:a=>Array.from(a),post(){},outlet(outlet,args){args=Array.from(args);events.push({type:'panel',outlet,args});if(outlet===0&&args[0]==='action')bridge.action(...args.slice(1));}};
 vm.createContext(panel);vm.runInContext(panelSource,panel,{filename:'md.panel.js'});
 bridge.initialized=true;bridge.liveDeviceReady=true;bridge.engineAvailable=true;bridge.engineReady=true;
 bridge.engine('catalog',JSON.stringify(catalog));bridge.syncControls();bridge.display();
 function advance(ms){const end=now+ms;for(;;){const next=tasks.filter(t=>!t.dead&&t.due<=end).sort((a,b)=>a.due-b.due)[0];if(!next)break;tasks=tasks.filter(t=>t!==next);now=next.due;next.fn.call(next.scope);}now=end;}
 function point(x,y){return[x*width/1120,y*height/250];}
 function mouse(method,x,y,...args){panel[method](...point(x,y),...args);}
 function select(track,page,group){mouse('onclick',panel.trackX(track)+20,210,1,0,0,0,0,0);mouse('onclick',327+page*70+25,55,1,0,0,0,0,0);if(group!==undefined){bridge.action('selectmaster',group);bridge.display();}advance(25);}
 function sends(){return bridge.cfg.tracks.map(tr=>[tr.params[19],tr.params[20]]);}
 function clear(){events=[];labels=[];}
 function all(){return events;}
 function live(){return events.filter(e=>e.type==='livewrite');}
 function native(){return events.filter(e=>e.type==='bridge'&&e.outlet===0).map(e=>e.args);}
 function focus(){return events.filter(e=>e.type==='bridge'&&e.outlet===3&&e.args[0]==='focusparameter').map(e=>e.args[1]);}
 function display(){bridge.display();}
 advance(100);clear();
 return {panel,bridge,control,advance,point,mouse,select,sends,clear,all,live,native,focus,display,labels:()=>labels};
}
function name(track,index){return 'md_t'+String(track+1).padStart(2,'0')+'_p'+String(index+1).padStart(2,'0');}
function onlySendWrite(h,track,index,value,why){
 const writes=h.live();same(writes,[{type:'livewrite',name:name(track,index),method:'int',value}],why+': actual permanent live.numbox int write');
 same(h.native(),[['param',track,index,value]],why+': native track parameter only');
 ok(!h.all().some(e=>e.type==='panel'&&e.args[1]==='setmaster'),why+': no master action');
}
for(const editor of [false,true]){
 const prefix=editor?'Editor':'Compact',h=host(editor),p=h.panel,b=h.bridge;
 // Distinct sends make accidental cross-track writes and view resets detectable.
 for(let t=0;t<16;t++){h.control(name(t,19)).message('int',20+t);h.control(name(t,20)).message('int',70+t);}
 h.display();const originalMaster=JSON.stringify(b.cfg.master);
 const ROUTE=2,KNOB=send=>3+send,sendView=send=>p.descriptor(KNOB(send));
 for(let track=0;track<16;track++)for(const page of [ROUTE])for(let send=0;send<2;send++){
  const index=19+send,x=p.knobX(KNOB(send)),y=110,identity=name(track,index),why=`${prefix} T${track+1} ROUTE ${send?'REV':'DEL'}`;
  h.select(track,page,(track+page)%4);h.clear();
  const d=sendView(send);
  same({kind:d.kind,track:d.track,index:d.index,min:d.min,max:d.max,value:d.value,def:d.def,enabled:d.enabled},{kind:'param',track,index,min:0,max:127,value:b.cfg.tracks[track].params[index],def:0,enabled:true},why+': fixed track descriptor on every page');
  same(p.hit(x,y),'knob'+KNOB(send),why+': visible send hit target');
  if(send===0){p.paint();ok(h.labels().includes('DEL')&&h.labels().includes('REV')&&!h.labels().some(l=>/ SENDS$/.test(l)),why+': both sends drawn on ROUTE, no top-bar copy');}
  // The whole label/value region is usable, including on the scaled compact panel.
  for(const hx of [x-30,x+30])same(p.hit(hx,165),'knob'+KNOB(send),why+': label/value hit target');
  h.clear();const beforeClick=h.sends();
  h.mouse('onclick',x,y,1,0,0,0,0,0);
  same(h.focus(),[identity],why+': plain click selects stable mapping parameter');
  same(h.live(),[],why+': mapping click does not change a value');
  same(h.sends(),beforeClick,why+': mapping click preserves kit');
  h.mouse('ondrag',x,y,0,0,0,0,0,0);
  h.clear();const beforeWheel=h.sends(),wheelValue=beforeWheel[track][send]+1;
  h.mouse('onwheel',x,y,0,1,0,0,0,0,0);
  same(h.focus(),[identity],why+': wheel focuses same permanent parameter');
  onlySendWrite(h,track,index,wheelValue,why+' wheel');
  const wheelExpected=beforeWheel.map(row=>row.slice());wheelExpected[track][send]=wheelValue;same(h.sends(),wheelExpected,why+': wheel isolated to selected send');
  const wheelEvents=h.all();ok(wheelEvents.findIndex(e=>e.type==='bridge'&&e.outlet===3&&e.args[0]==='focusparameter')<wheelEvents.findIndex(e=>e.type==='livewrite'),why+': focus precedes value write');
  h.clear();h.mouse('onclick',x,y,1,0,0,0,0,0);const dragStart=b.cfg.tracks[track].params[index];
  h.mouse('ondrag',x,y-14,1,0,0,0,0,0);h.mouse('ondrag',x,y-14,0,0,0,0,0,0);
  const dragValue=Math.round(Math.min(127,dragStart+127/10));
  same(h.focus(),[identity],why+': drag requests focus once at mouse-down');
  onlySendWrite(h,track,index,dragValue,why+' drag');
  h.clear();h.mouse('ondblclick',x,y,1,0,0,0,0,0);
  same(h.focus(),[identity],why+': reset focuses same parameter');
  onlySendWrite(h,track,index,0,why+' reset');
  h.clear();h.mouse('onclick',x,y,1,0,0,0,0,0);h.mouse('ondrag',x,y,0,0,0,0,0,0);h.clear();p.key(38);
  onlySendWrite(h,track,index,1,why+' keyboard');
  // Host automation updates the same stored value and visible send.
  h.clear();h.control(identity).message('int',40+track);h.advance(25);
  same(sendView(send).value,40+track,why+': host automation updates visible send');
  same(JSON.stringify(b.cfg.master),originalMaster,why+': shared master settings preserved');
 }
 // Every machine uses the same per-track send controls; a synth change retains sends.
 for(let track=0;track<16;track++){
  h.select(track,ROUTE);h.control(name(track,19)).message('int',track+11);h.control(name(track,20)).message('int',track+81);
  const before=h.sends(),machine=catalog.find(m=>m.id!==b.cfg.tracks[track].machine);h.clear();b.action('setmachine',track,machine.id);h.advance(25);
  same(h.sends(),before,`${prefix} T${track+1}: changing machine preserves every track send`);
  same([sendView(0).value,sendView(1).value],[track+11,track+81],`${prefix} T${track+1}: switched machine still displays sends`);
  ok(h.live().every(e=>e.name===`md_t${String(track+1).padStart(2,'0')}_machine`||/^md_t\d\d_p0[1-8]$/.test(e.name)),`${prefix} T${track+1}: machine change only writes machine and SYN`);
 }
 h.select(0,0);const beforeMachines=h.sends();
 for(const machine of catalog){b.action('setmachine',0,machine.id);h.advance(25);same(h.sends(),beforeMachines,`${prefix} ${machine.name}: sends survive machine change`);}
 // Track/page navigation and all master subpages must not rotate parameter IDs.
 const beforeNavigation=h.sends();
 for(let track=15;track>=0;track--)for(let page=4;page>=0;page--){h.select(track,page,page%4);h.select(track,ROUTE);same([sendView(0).value,sendView(1).value],beforeNavigation[track],`${prefix}: navigation shows stored T${track+1} sends`);}
 same(h.sends(),beforeNavigation,`${prefix}: navigation preserves all sends`);
 // Saving/restoring the actual serialized bridge state retains sends and native controls.
 const saved=Array.from(b.getvalueof()),restored=host(editor);restored.bridge.setvalueof(...saved);restored.bridge.display();
 same(restored.sends(),h.sends(),`${prefix}: saved-state restore preserves all 32 sends`);
 for(let track=0;track<16;track++)for(let send=0;send<2;send++)same(restored.control(name(track,19+send)).getvalueof(),h.sends()[track][send],`${prefix}: restore synchronizes permanent native send parameter`);
 // Bounds and fine drag retain the same fixed parameter and never write a master bus.
 h.select(4,ROUTE,0);for(const send of [0,1]){
  const index=19+send,x=p.knobX(KNOB(send));h.control(name(4,index)).message('int',127);h.display();h.clear();h.mouse('onwheel',x,110,0,1,0,0,0,0,0);same(h.live(),[],`${prefix}: send upper bound is127`);
  h.control(name(4,index)).message('int',0);h.display();h.clear();h.mouse('onwheel',x,110,0,-1,0,0,0,0,0);same(h.live(),[],`${prefix}: send lower bound is0`);
  h.mouse('onclick',x,110,1,0,0,0,0,0);h.clear();h.mouse('ondrag',x,96,1,0,1,0,0,0);h.mouse('ondrag',x,96,0,0,1,0,0,0);onlySendWrite(h,4,index,1,`${prefix}: Shift fine drag`);
 }
 p.notifydeleted();b.notifydeleted();restored.panel.notifydeleted();restored.bridge.notifydeleted();
}
console.log(`PASS panel sends: ${checks} assertions across 16 tracks, 5 pages, compact and Editor panels; stable automation, focus, persistence and all ${catalog.length} machines`);
