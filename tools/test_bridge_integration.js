#!/usr/bin/env node
'use strict';
// Audit the real bridge and generated patch contracts. Fake Max controls model
// parameter feedback; MIDI graph evaluation follows the generated connections.
// Native DSP and live-host UI behavior require the separate Max/audio reports.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const generated=cp.spawnSync('python3',['-B','-c','import json,sys;sys.path.insert(0,"tools");from build_device import build;print(json.dumps(build()))'],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
assert.equal(generated.status,0,generated.stderr);
const patch=JSON.parse(generated.stdout).patcher,boxes=new Map(patch.boxes.map(x=>[x.box.id,x.box]));
const source=fs.readFileSync(path.join(root,'device/md.bridge.js'),'utf8');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'artifacts/machine-catalog.json'),'utf8'));
const sound=[...boxes.values()].filter(b=>b.maxclass==='live.numbox'&&b.parameter_enable===1);
let checks=0;
function same(a,b,msg){checks++;assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),msg);}
function ok(a,msg){checks++;assert.ok(a,msg);}
function attrs(b){return b.saved_attribute_attributes.valueof;}
function wires(s,so,d,di){return patch.lines.some(x=>{const p=x.patchline;return p.source[0]===s&&p.source[1]===so&&p.destination[0]===d&&p.destination[1]===di;});}
function host(){
 let now=0,tasks=[],events=[],notifications=0;const objects=new Map();let c;
 class Task{constructor(fn,scope){this.fn=fn;this.scope=scope;this.dead=false;}schedule(ms){this.due=now+ms;tasks.push(this);}cancel(){this.dead=true;}freepeer(){this.dead=true;}}
 for(const b of sound)objects.set(b.varname,{value:attrs(b).parameter_initial[0],getvalueof(){return this.value;},message(method,v){this.value=v;events.push({kind:'control',name:b.varname,method,value:v});if(method!=='set')c.control(b.varname,v);}});
 c={Task,max:{os:'macintosh',arch:'arm64'},patcher:{getnamed:n=>objects.get(n),getattr:()=>0,setattr(){}},notifyclients(){notifications++;},post(){},outlet(outlet,args){events.push({kind:'out',outlet,args:Array.from(args)});}};
 vm.createContext(c);vm.runInContext(source,c,{filename:'md.bridge.js'});
 function advance(ms){const end=now+ms;for(;;){const n=tasks.filter(t=>!t.dead&&t.due<=end).sort((a,b)=>a.due-b.due)[0];if(!n)break;tasks=tasks.filter(t=>t!==n);now=n.due;n.fn.call(n.scope);}now=end;}
 function ready(){c.initialized=true;c.liveDeviceReady=true;c.engineAvailable=true;c.engineReady=true;c.cfg.firmware='/Users/test/OS.syx';c.loadedPath=c.cfg.firmware;c.engine('catalog',JSON.stringify(catalog));c.syncControls();advance(25);events=[];}
 return{c,objects,advance,ready,clear(){events=[];},events:()=>events,native:()=>events.filter(e=>e.kind==='out'&&e.outlet===0).map(e=>e.args),gates:()=>events.filter(e=>e.kind==='out'&&e.outlet===3&&e.args[0]==='ready').map(e=>e.args[1]),notifications:()=>notifications};
}
// Every automation identity is permanent, unique, visible and wired back to state.
same(sound.length,513,'513 sound parameters');same(new Set(sound.map(b=>b.varname)).size,513,'unique scripting names');
const names=sound.map(b=>attrs(b).parameter_longname);same(new Set(names).size,513,'unique host names');
for(const b of sound){const a=attrs(b);same(patch.parameters[b.id],[a.parameter_longname,a.parameter_shortname,0],b.id+' registry');same(a.parameter_invisible,0,b.id+' exposed to host');ok(a.parameter_initial[0]>=a.parameter_mmin&&a.parameter_initial[0]<=a.parameter_mmax,b.id+' default in bounds');ok(wires(b.id,0,b.id+'_pre',0)&&wires(b.id+'_pre',0,'bridge',0),b.id+' actual control feedback');same(boxes.get(b.id+'_pre').text,'prepend control '+b.varname,b.id+' stable feedback address');}
const bankNames=Object.values(patch.parameters.parameterbanks).flatMap(b=>b.parameters.filter(n=>n!=='-'));
same(bankNames.length,513,'all sound parameters covered by banks exactly once');same(new Set(bankNames).size,513,'no duplicate bank slots');same([...bankNames].sort(),names.sort(),'banks reference actual long names');
same(attrs(boxes.get('saved_state')).parameter_invisible,1,'persistent state hidden from mapping');
ok(wires('actions',3,'parameter_focus_pre',0)&&wires('parameter_focus_pre',0,'parameter_focus',0),'focus action reaches helper');
ok(wires('actions',1,'engine_ready_gate',0),'readiness controls native MIDI gate');
// Existing release metadata remains compatible: MIDI additions cannot renumber parameters.
const baselineReport=JSON.parse(fs.readFileSync(path.join(root,'artifacts/frozen-device-verification-1.0.2.json'),'utf8'));
const baseline=fs.readFileSync(path.join(root,'release/MD Drum Engine 1.0.2.amxd'));
const entry=baselineReport.entries.find(e=>e.name==='MD Drum Engine.maxpat');
const released=JSON.parse(baseline.subarray(entry.offset,entry.offset+entry.bytes).toString('utf8').replace(/\0+$/,'')).patcher;
same(patch.parameters,released.parameters,'all released parameter IDs, names and banks unchanged');
// Exercise actual UI and host control boundaries for every parameter family.
{
 const h=host();h.ready();const c=h.c;
 for(const b of sound){
  const a=attrs(b),target=a.parameter_type===0?0.43:(h.objects.get(b.varname).value+1)%(a.parameter_mmax+1);h.clear();
  h.objects.get(b.varname).message(a.parameter_type===0?'float':'int',target);
  let match,value,expected;
  if((match=/^md_t(\d\d)_p(\d\d)$/.exec(b.varname))){const t=+match[1]-1,k=+match[2]-1;value=c.cfg.tracks[t].params[k];expected=['param',t,k,target];c.action('focusparam','param',t,0,k);}
  else if((match=/^md_t(\d\d)_lfo(\d\d)$/.exec(b.varname))){const t=+match[1]-1,k=+match[2]-1;value=c.cfg.tracks[t].lfo[k];expected=['lfo',t,k,target];c.action('focusparam','lfo',t,0,k);}
  else if((match=/^md_master([0-3])_(\d\d)$/.exec(b.varname))){const g=+match[1],k=+match[2]-1;value=c.cfg.master[g][k];expected=['master',g,k,target];c.action('focusparam','master',0,g,k);}
  else if((match=/^md_t(\d\d)_machine$/.exec(b.varname))){const t=+match[1]-1;value=c.cfg.tracks[t].machine;expected=['machine',t,c.MACHINE_IDS[target]];same(value,c.MACHINE_IDS[target],b.varname+' enum selects machine');}
  else{value=c.cfg.gain;expected=null;c.action('focusparam','gain',0,0,0);}
  if(!b.varname.endsWith('_machine'))same(value,target,b.varname+' host automation persisted');
  if(expected)ok(h.native().some(m=>JSON.stringify(m)===JSON.stringify(expected)),b.varname+' exact native command');
  if(!b.varname.endsWith('_machine'))same(h.events().filter(e=>e.kind==='out'&&e.outlet===3&&e.args[0]==='focusparameter').map(e=>e.args[1]),[b.varname],b.varname+' exact LFO Map identity');
 }
 const saved=Array.from(c.getvalueof()),before=JSON.stringify(c.cfg),cold=host();cold.c.setvalueof(...saved);
 same(JSON.stringify(cold.c.cfg),before,'all parameters survive cold restore before init');same(cold.events().filter(e=>e.kind==='control').length,0,'cold restore waits for Live readiness');
 for(const b of sound)cold.objects.get(b.varname).message(attrs(b).parameter_type===0?'float':'int',attrs(b).parameter_initial[0]);
 same(JSON.stringify(cold.c.cfg),before,'native initial output cannot overwrite restored state before live.thisdevice');
 cold.c.init();cold.c.engine('engineinfo','1.0.1','arm64');cold.advance(100);cold.c.engine('ready',0);cold.c.engine('ready',1);cold.c.thisdeviceready();
 for(const b of sound)same(cold.objects.get(b.varname).value,h.objects.get(b.varname).value,b.varname+' restored host parameter');
 cold.c.notifydeleted();c.notifydeleted();
}
// Runtime recall must apply a kit before MIDI can be admitted again.
{
 const h=host();h.ready();const c=h.c,s=JSON.parse(JSON.stringify(c.cfg));s.tracks[0].params[0]=103;s.tracks[15].lfo[4]=2;s.master[3][7]=83;s.gain=0.41;
 h.clear();c.setvalueof('MDENGINESTATE1',JSON.stringify(s));
 same(h.gates()[0],0,'same-ROM recall closes gate immediately');same(h.gates().at(-1),1,'same-ROM recall reopens gate after sync');
 ok(h.native().some(a=>JSON.stringify(a)===JSON.stringify(['param',0,0,103])),'same-ROM recall applies new synth value immediately');
 same(h.native().filter(a=>a[0]==='firmware').length,0,'same-ROM recall does not reload native firmware');
 same(h.native().filter(a=>a[0]==='panic').length,0,'same-ROM recall preserves sounding tails');
 const e=h.events(),lastCommand=e.reduce((n,x,i)=>x.kind==='out'&&x.outlet===0?i:n,-1),open=e.findLastIndex(x=>x.kind==='out'&&x.outlet===3&&x.args[0]==='ready'&&x.args[1]===1);
 ok(open>lastCommand,'MIDI opens only after full recalled kit is queued');h.clear();h.advance(100);same(h.native().length,0,'no duplicate delayed kit synchronization');
 s.firmware='/Volumes/External/Other.syx';h.clear();c.setvalueof('MDENGINESTATE1',JSON.stringify(s));same(c.engineReady,false,'different-ROM recall immediately marks not ready');same(h.gates().at(-1),0,'different-ROM recall immediately closes gate');same(h.native(),[['panic']],'different-ROM recall immediately silences old voices before deferred load');same(h.events()[0].args,['ready',0],'recall closes MIDI before sending Panic');h.advance(99);same(h.native().filter(a=>a[0]==='firmware').length,0,'reload remains deferred');h.advance(1);same(h.native().filter(a=>a[0]==='firmware'),[['firmware',s.firmware]],'new selected path is dispatched once');
 c.engine('error','Missing file');c.engine('ready',0);same(c.engineStatus,'Missing file','ready 0 retains error');h.clear();c.action('panic');same(h.native(),[['panic']],'panic remains available after errors');
 s.firmware='';h.clear();c.setvalueof('MDENGINESTATE1',JSON.stringify(s));h.advance(100);same(h.native(),[['panic']],'blank ROM state silences prior engine without firmware request');same(c.engineReady,false,'blank state cannot trigger notes');c.notifydeleted();
}
// Clearing or explicitly replacing an active ROM silences it before any timer.
{
 const h=host();h.ready();const c=h.c,s=JSON.parse(JSON.stringify(c.cfg));s.firmware='';
 c.setvalueof('MDENGINESTATE1',JSON.stringify(s));same(h.native(),[['panic']],'active blank recall immediately silences voices and tails');same(h.gates().at(-1),0,'blank recall gate remains closed');same(c.engineReady,false,'blank recall immediately disables audition');
 c.action('audition',0,100);same(h.native(),[['panic']],'blank recall cannot sneak an audition into old ROM');h.advance(99);same(h.native(),[['panic']],'blank recall silence does not wait for boot');
 h.advance(1);same(h.native(),[['panic'],['panic']],'deferred blank boot retains a safe silence fallback');same(c.engineStatus,'Select OS 1.63','blank recall shows selection prompt');
 c.notifydeleted();
 for(const selected of ['/Users/test/OS.syx','/Volumes/Drum Library/New OS.syx']){
  const r=host();r.ready();r.c.firmwarepath(selected);same(r.native(),[['panic']],'explicit same/new ROM selection immediately silences old session');same(r.events()[0].args,['ready',0],'explicit selection closes MIDI before Panic');
  r.advance(100);same(r.native(),[['panic'],['firmware',selected]],'explicit ROM selection dispatches only after silencing');r.c.notifydeleted();
 }
}
// A recoverable drop warning cannot permanently close MIDI or mutate the kit.
{
 const h=host();h.ready();const c=h.c,saved=JSON.stringify(c.cfg);h.clear();c.engine('warning','Control queue full; some commands were dropped');same(c.engineReady,true,'warning preserves readiness');same(h.gates(),[],'warning does not close MIDI gate');same(JSON.stringify(c.cfg),saved,'warning preserves kit');c.action('audition',0,100);same(h.native(),[['trigger',0,100]],'notes remain possible after warning');
 h.clear();c.engine('error','DSP emulation stopped');same(c.engineReady,false,'fatal error disables readiness');same(h.gates(),[0],'fatal error closes MIDI gate');c.action('audition',0,100);same(h.native(),[],'fatal error rejects audition');c.notifydeleted();
}
// Bounds, cross-track/master isolation, and malformed recall rejection.
{
 const h=host();h.ready();const c=h.c;
 for(let t=0;t<16;t++)for(let k=0;k<24;k++){c.action('setparam',t,k,-9);same(c.cfg.tracks[t].params[k],0,'parameter lower bound');c.action('setparam',t,k,200);same(c.cfg.tracks[t].params[k],127,'parameter upper bound');}
 for(let t=0;t<16;t++)for(let k=0;k<5;k++){c.action('setlfo',t,k,999);same(c.cfg.tracks[t].lfo[k],c.LFO_MAX[k],'LFO hardware upper bound');}
 for(let g=0;g<4;g++)for(let k=0;k<8;k++){c.action('setmaster',g,k,999);same(c.cfg.master[g][k],127,'master upper bound');}
 c.action('gain',-5);same(c.cfg.gain,0,'gain lower bound');c.action('gain',5);same(c.cfg.gain,1,'gain upper bound');
 const before=JSON.stringify(c.cfg);for(const input of ['not JSON','{}','{"version":2,"tracks":[]}','{"version":1,"tracks":[]}'])c.setvalueof(input);same(JSON.stringify(c.cfg),before,'invalid state rejected without mutation');
 h.clear();for(const args of [['param',16,0,0],['param',-1,0,0],['param',0,0,24],['lfo',0,0,5],['master',0,4,0],['gain',1,0,0],['param','0',0,0]])c.action('focusparam',...args);same(h.events(),[],'invalid mapping identities rejected');
 h.clear();c.hosttempo(700);same(h.native(),[['tempo',700]],'host tempo above 400 remains exact at native boundary');c.notifydeleted();
}
// Evaluate the reachable generated MIDI graph using documented native object semantics.
function midiGraph(ready){
 const state=new Map(),received=[];state.set('engine_ready_gate',ready?1:0);state.set('note_pack',[0,0]);
 function emit(id,outlet,value){for(const l of patch.lines){const p=l.patchline;if(p.source[0]===id&&p.source[1]===outlet)input(p.destination[0],p.destination[1],value);}}
 function input(id,inlet,value){
  if(id==='engine'){received.push(value);return;}
  const b=boxes.get(id),text=b.text||'';
  if(text.startsWith('split ')){const [,lo,hi]=text.split(' ').map(Number);emit(id,value>=lo&&value<=hi?0:1,value);}
  else if(text==='- 36')emit(id,0,value-36);
  else if(text==='pack i i'){const a=state.get(id);a[inlet]=value;if(inlet===0)emit(id,0,a.slice());}
  else if(text==='if $i1 >= 0 && $i2 > 0 then $i1 $i2'){if(value[0]>=0&&value[1]>0)emit(id,0,value);}
  else if(text==='prepend trigger')emit(id,0,['trigger',...value]);
  else if(text==='gate 1 0'){if(inlet===0)state.set(id,value);else if(state.get(id))emit(id,0,value);}
  else if(b.maxclass==='message'&&text==='panic')emit(id,0,['panic']);
  else throw Error('Unexpected object on MIDI graph: '+id+' '+text);
 }
 function note(pitch,velocity,channel){received.length=0;emit('notein',2,channel);emit('notein',1,velocity);emit('notein',0,pitch);return received.slice();}
 function cc(controller,value,channel){received.length=0;const b=boxes.get('all_sound_off');same(b.text,'ctlin 120','only All Sound Off controller selected');if(controller===Number(b.text.split(' ')[1])){emit(b.id,1,channel);emit(b.id,0,value);}return received.slice();}
 return{note,cc};
}
for(const ready of [false,true]){
 const g=midiGraph(ready);
 for(const channel of [1,16])for(let pitch=0;pitch<128;pitch++)for(const velocity of [0,1,127]){const track=pitch>=36&&pitch<=51?pitch-36:pitch<=15?pitch:-1;same(g.note(pitch,velocity,channel),ready&&velocity>0&&track>=0?[['trigger',track,velocity]]:[],`MIDI note ${pitch}/${velocity} channel${channel} ready${ready}`);}
 for(const channel of [1,16])for(let cc=0;cc<128;cc++)for(const value of [0,127])same(g.cc(cc,value,channel),cc===120?[['panic']]:[],`MIDI CC${cc}/${value} channel${channel} cannot become a note`);
}
console.log(`PASS bridge/patch integration: ${checks} checks; 513 stable host parameters, restore ordering, full native MIDI routing, CC120 panic, warnings, bounds and focus`);
