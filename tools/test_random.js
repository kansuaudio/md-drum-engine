#!/usr/bin/env node
'use strict';
// Dice, Random All, Reset, kit files and one-level Undo through the real bridge
// and fake Live parameters and files.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const generated=cp.spawnSync('python3',['-B','-c','import json,sys;sys.path.insert(0,"tools");from build_device import build;print(json.dumps(build()))'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(generated.status,0,generated.stderr);
const patch=JSON.parse(generated.stdout).patcher;
const source=fs.readFileSync(path.join(root,'device/md.bridge.js'),'utf8');
const panelSource=fs.readFileSync(path.join(root,'device/md.panel.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'artifacts/machine-catalog.json'),'utf8'));
const sound=patch.boxes.map(x=>x.box).filter(b=>b.maxclass==='live.numbox'&&b.parameter_enable===1);
let checks=0;
function same(a,b,msg){checks++;assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),msg);}
function ok(a,msg){checks++;assert.ok(a,msg);}
function host(){
 let now=0,tasks=[],events=[];const objects=new Map();let c;
 class Task{constructor(fn,scope){this.fn=fn;this.scope=scope;this.dead=false;}schedule(ms){this.due=now+ms;tasks.push(this);}cancel(){this.dead=true;}freepeer(){this.dead=true;}}
 for(const b of sound)objects.set(b.varname,{value:b.saved_attribute_attributes.valueof.parameter_initial[0],getvalueof(){return this.value;},message(method,v){this.value=v;events.push({kind:'control',name:b.varname,method,value:v});if(method!=='set')c.control(b.varname,v);}});
 const files=new Map();
 class File{constructor(path,mode){this.path=path;this.mode=mode;this.isopen=mode==='write'||files.has(path);this.data=mode==='write'?(files.get(path)||''):(files.get(path)||'');this.position=0;}get eof(){return this.data.length;}set eof(n){this.data=this.data.slice(0,n);}writestring(t){this.data=this.data.slice(0,this.position)+t+this.data.slice(this.position+t.length);this.position+=t.length;}readstring(n){const r=this.data.slice(this.position,this.position+n);this.position+=r.length;return r;}close(){if(this.mode==='write')files.set(this.path,this.data);}}
 c={Task,File,max:{os:'macintosh',arch:'arm64'},patcher:{getnamed:n=>objects.get(n),getattr:()=>0,setattr(){}},notifyclients(){},post(){},outlet(outlet,args){events.push({kind:'out',outlet,args:Array.from(args)});}};
 vm.createContext(c);vm.runInContext(source,c,{filename:'md.bridge.js'});
 function advance(ms){const end=now+ms;for(;;){const n=tasks.filter(t=>!t.dead&&t.due<=end).sort((a,b)=>a.due-b.due)[0];if(!n)break;tasks=tasks.filter(t=>t!==n);now=n.due;n.fn.call(n.scope);}now=end;}
 function ready(){c.initialized=true;c.liveDeviceReady=true;c.engineAvailable=true;c.engineReady=true;c.cfg.firmware='/Users/test/OS.syx';c.loadedPath=c.cfg.firmware;c.engine('catalog',JSON.stringify(catalog));c.syncControls();advance(25);events=[];}
 function state(){advance(30);const s=events.filter(e=>e.kind==='out'&&e.outlet===1&&e.args[0]==='state').at(-1);return s&&JSON.parse(s.args[1]);}
 return{c,objects,files,advance,ready,state,clear(){events=[];},events:()=>events,native:()=>events.filter(e=>e.kind==='out'&&e.outlet===0).map(e=>e.args)};
}
const FX_RANGE={8:[0,56],9:[0,127],10:[0,127],11:[40,88],12:[0,24],13:[96,127],14:[0,48],15:[0,40],16:[0,64]};
function labels(c,t){return c.machineInfo(c.cfg.tracks[t].machine).labels;}
// Not ready: no roll, no parameter writes.
{const h=host();h.c.initialized=true;h.c.action('randomall');ok(!h.events().some(e=>e.kind==='control'),'no OS: dice writes nothing');}
// Single-track rolls: only SYN (labelled) and soft FX change, all inside their ranges.
{
 const h=host();h.ready();const c=h.c;
 const before=JSON.parse(JSON.stringify(c.cfg));
 for(let roll=0;roll<200;roll++){
  const t=roll%16,prev=JSON.parse(JSON.stringify(c.cfg));h.clear();c.action('random',t);
  const tr=c.cfg.tracks[t],lab=labels(c,t);
  same(tr.machine,prev.tracks[t].machine,'machine unchanged');
  same(tr.params.slice(17),prev.tracks[t].params.slice(17),'VOL, PAN, DEL, REV and LFO amounts unchanged');
  same(tr.lfo,prev.tracks[t].lfo,'LFO setup unchanged');
  for(let k=0;k<8;k++)if(!lab[k])same(tr.params[k],prev.tracks[t].params[k],'unused SYN slot untouched');
  for(const k in FX_RANGE)ok(tr.params[k]>=FX_RANGE[k][0]&&tr.params[k]<=FX_RANGE[k][1],'FX '+k+' inside its soft range');
  for(let o=0;o<16;o++)if(o!==t)same(c.cfg.tracks[o],prev.tracks[o],'other tracks untouched');
  same(c.cfg.master,prev.master,'master untouched');
  // Each changed value reached the engine as a normal parameter command.
  for(let k=0;k<17;k++)if(tr.params[k]!==prev.tracks[t].params[k])ok(h.native().some(m=>m[0]==='param'&&m[1]===t&&m[2]===k&&m[3]===tr.params[k]),'roll reaches engine');
  // Values are real Live parameter values (saved with the set, automatable).
  for(let k=0;k<17;k++)same(h.objects.get(c.trackName(t,'p',k)).value,tr.params[k],'Live parameter holds the rolled value');
 }
 ok(JSON.stringify(before)!==JSON.stringify(c.cfg),'rolls change the kit');
 // Undo restores exactly the last roll, once.
 const beforeRoll=JSON.parse(JSON.stringify(c.cfg));c.action('random',5);ok(h.state().canUndo===true,'panel learns undo is available');
 c.action('undo');same(c.cfg,beforeRoll,'undo restores the track exactly');ok(h.state().canUndo===false,'undo is single-use');
 h.clear();c.action('undo');ok(!h.events().some(e=>e.kind==='control'),'second undo does nothing');
 // A short LCD confirmation returns to the ready line.
 c.action('random',2);ok(c.engineStatus.includes('T03 randomized'),'roll confirmation');h.advance(3000);same(c.engineStatus,'OS 1.63 ready · MIDI 36–51','confirmation expires');
}
// Random All touches all 16 tracks, and its Undo restores all of them.
{
 const h=host();h.ready();const c=h.c;const before=JSON.parse(JSON.stringify(c.cfg));
 c.action('randomall');let changed=0;
 for(let t=0;t<16;t++){if(JSON.stringify(c.cfg.tracks[t].params.slice(0,17))!==JSON.stringify(before.tracks[t].params.slice(0,17)))changed++;same(c.cfg.tracks[t].params.slice(17),before.tracks[t].params.slice(17),'Random All keeps mix and sends');same(c.cfg.tracks[t].machine,before.tracks[t].machine,'Random All keeps machines');}
 same(changed,16,'Random All rolls every track');
 const saved=Array.from(c.getvalueof()),cold=host();cold.c.setvalueof(...saved);same(cold.c.cfg.tracks,c.cfg.tracks,'rolled kit is saved with the set');
 c.action('undo');same(c.cfg,before,'Random All undo restores all tracks');
 c.action('randomall');c.setvalueof(...saved);ok(!c.lastUndo,'preset recall clears stale undo');
}
// Reset returns to the device's starting kit (factory SYN values of the OS), and Undo brings the old kit back.
{
 const h=host();h.ready();const c=h.c;const initial={tracks:c.kitSnapshot().tracks,master:c.kitSnapshot().master};
 c.action('randomall');for(let t=0;t<16;t++){h.objects.get(c.trackName(t,'p',17)).message('int',90);}c.action('setmachine',3,32);h.objects.get(c.masterName(1,7)).message('int',12);
 const changed=c.kitSnapshot();c.action('resetkit');same(c.kitSnapshot(),initial,'Reset restores machines, every parameter, LFOs and master');
 ok(c.engineStatus.includes('Default kit restored'),'reset confirmation');
 c.action('undo');same(c.kitSnapshot(),changed,'Undo after Reset restores the previous kit, machines included');
}
// Kit files: save anywhere, load back exactly; bad files are rejected without touching the kit.
{
 const a=host();a.ready();a.c.action('randomall');a.c.action('setmachine',5,38);a.objects.get(a.c.masterName(0,2)).message('int',99);
 const path='Macintosh HD:/Users/test/Kits/Dub Techno.mdkit';a.c.savekitpath(path);
 ok(a.files.has(path),'kit file written');const text=a.files.get(path);ok(/"name": "Dub Techno"/.test(text)&&/"machine":"EFM-HH"/.test(text),'readable JSON with kit and machine names');
 same(text.split('\n').length,30,'one line per track and master effect');
 const b=host();b.ready();const beforeLoad=b.c.kitSnapshot();b.files.set(path,text);b.c.loadkitpath(...path.split(' '));
 same(b.c.kitSnapshot(),a.c.kitSnapshot(),'loaded kit equals the saved kit');ok(b.c.engineStatus.includes('Kit loaded: Dub Techno'),'load confirmation');
 ok(b.native().some(m=>m[0]==='machine'&&m[1]===5&&m[2]===38),'loaded machine reaches the engine');
 b.c.action('undo');same(b.c.kitSnapshot(),beforeLoad,'Undo after Load Kit restores the previous kit');
 const c=host();c.ready();const before=c.c.kitSnapshot();
 for(const bad of ['not json','{"format":"something else"}',JSON.stringify({format:'MD Drum Engine kit',version:1,tracks:[]}),text.replace('"id":38','"id":999').replace('"EFM-HH"','"XXX"')]){
  c.files.set('x.mdkit',bad);c.c.loadkitpath('x.mdkit');same(c.c.kitSnapshot(),before,'bad kit leaves the current kit untouched');ok(c.c.engineStatus.startsWith('Kit not loaded'),'bad kit is reported');
 }
 c.c.loadkitpath('missing.mdkit');ok(c.c.engineStatus.startsWith('Kit not loaded'),'missing file is reported');
 // Non-ASCII kit names survive as escaped JSON.
 a.c.savekitpath('C:/Kits/音楽.mdkit');ok(/\\u97f3/.test(a.files.get('C:/Kits/音楽.mdkit')),'non-ASCII name escaped');
 const d=host();d.ready();d.files.set('k.mdkit',a.files.get('C:/Kits/音楽.mdkit'));d.c.loadkitpath('k.mdkit');same(d.c.kitSnapshot(),a.c.kitSnapshot(),'escaped file loads');
 // The dialogs are reached through the host actions outlet.
 a.clear();a.c.action('savekit');same(a.events().filter(e=>e.kind==='out'&&e.outlet===3).map(e=>e.args),[['kitname','MD-Kit.mdkit'],['savekit']],'Save Kit names a default file then opens the save dialog');
 a.clear();a.c.action('loadkit');same(a.events().filter(e=>e.kind==='out'&&e.outlet===3).map(e=>e.args),[['loadkit']],'Load Kit opens the file dialog');
}
// Panel: dice targets, buttons and emitted actions.
{
 let outputs=[];const graphics=new Proxy({text_measure:s=>[String(s).length*5,10]},{get:(o,k)=>k in o?o[k]:(()=>{})});
 const p={Task:class{schedule(){}cancel(){}freepeer(){}},mgraphics:graphics,box:{rect:[0,0,1120,250]},jsarguments:['md.panel.js',''],arrayfromargs:a=>Array.from(a),outlet:(...a)=>outputs.push(a),post:()=>{}};
 vm.createContext(p);vm.runInContext(panelSource,p);
 p.state(JSON.stringify({ready:true,canUndo:false,catalog:[],tracks:[],master:[[],[],[],[]]}));
 for(let t=0;t<16;t++){same(p.hit(p.trackX(t)+p.DIE_X+4,p.DIE_Y+4),'dice'+t,'die '+(t+1)+' is hit');same(p.hit(p.trackX(t)+6,215),'track'+t,'rest of key still selects');same(p.hit(p.trackX(t)+20,210),'track'+t,'click beside the die selects');}
 same(p.hit(699,20),'randomall','Random All hit');same(p.hit(736,20),'undo','Undo hit');same(p.hit(780,20),'reset','Reset hit');same(p.hit(233,20),'loadkit','Load Kit hit');same(p.hit(313,20),'savekit','Save Kit hit');
 outputs=[];p.onclick(p.trackX(6)+p.DIE_X+4,p.DIE_Y+4,1,0,0,0,0,0);same(outputs.map(o=>o[1].slice(1)),[['random',6]],'die click rolls its track');same(p.model.selected,0,'die click keeps the selection');
 outputs=[];p.onclick(699,20,1,0,0,0,0,0);same(outputs.map(o=>o[1].slice(1)),[['randomall']],'Random All click');
 outputs=[];p.onclick(736,20,1,0,0,0,0,0);same(outputs.length,0,'Undo is inactive without a roll');
 p.state(JSON.stringify({canUndo:true}));outputs=[];p.onclick(736,20,1,0,0,0,0,0);same(outputs.map(o=>o[1].slice(1)),[['undo']],'Undo click');
 outputs=[];p.onclick(780,20,1,0,0,0,0,0);same(outputs.map(o=>o[1].slice(1)),[['resetkit']],'Reset click');
 outputs=[];p.onclick(233,20,1,0,0,0,0,0);p.onclick(313,20,1,0,0,0,0,0);same(outputs.map(o=>o[1].slice(1)),[['loadkit'],['savekit']],'kit buttons');
 p.state(JSON.stringify({ready:false}));outputs=[];p.onclick(699,20,1,0,0,0,0,0);p.onclick(p.trackX(0)+p.DIE_X+4,p.DIE_Y+4,1,0,0,0,0,0);same(outputs.length,0,'dice inactive until OS is ready');
 p.state(JSON.stringify({ready:true}));p.hover='dice2';ok(p.hoverHint().includes('T03'),'die hover explains itself');
}
console.log('PASS random/kits: '+checks+' checks; dice, Random All, Reset, kit save/load, Undo, panel targets');
