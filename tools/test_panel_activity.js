// Regression: real note feedback is polyphonic, transient and never changes sound state.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(require('path').join(__dirname,'../device/md.panel.js'),'utf8');
let checks=0;
for(const editor of [false,true]){
 let now=1000,tasks=[],outputs=[],labels=[];
 class ClockDate extends Date {constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 class Task {constructor(fn,context){this.fn=fn;this.context=context;this.dead=false;}schedule(ms){this.due=now+ms;tasks.push(this);}cancel(){this.dead=true;}freepeer(){this.dead=true;}}
 const graphics=new Proxy({text_measure:s=>[String(s).length*5,10],show_text:s=>labels.push(String(s))},{get:(o,k)=>k in o?o[k]:(()=>{})});
 const c={Task,Date:ClockDate,mgraphics:graphics,box:{rect:[0,0,1120,250]},jsarguments:['md.panel.js',editor?'editor':''],arrayfromargs:a=>Array.from(a),outlet:(...a)=>outputs.push(a),post:()=>{}};
 vm.createContext(c);vm.runInContext(source,c);
 function advance(ms){const end=now+ms;for(;;){const pending=tasks.filter(t=>!t.dead&&t.due<=end).sort((a,b)=>a.due-b.due);if(!pending.length)break;const t=pending[0];tasks=tasks.filter(x=>x!==t);now=t.due;t.fn.call(t.context);}now=end;}
 function ok(value,message){assert(value,(editor?'Editor: ':'Compact: ')+message);checks++;}
 advance(100);outputs=[];
 vm.runInContext('model.ready=true; model.tracks=[{machine:16,params:Array(24).fill(0),lfo:[0,0,0,0,0]}]; model.master=[[],[],[],[]];',c);
 const state=JSON.stringify(c.model);
 c.activity(1|8|32768);
 ok(c.activityUntil[0]>now&&c.activityUntil[3]>now&&c.activityUntil[15]>now,'simultaneous notes light independently');
 ok(c.activityUntil[1]===0,'other tracks stay dark');
 ok(outputs.length===0&&JSON.stringify(c.model)===state,'feedback emits no controls and mutates no saved model');
 ok(c.activityLevel(0,now)===1,'a hit starts at full brightness');
 advance(80);ok(c.activityLevel(0,now)>0&&c.activityLevel(0,now)<1,'the pulse fades after its hold time');
 c.activity(8);ok(c.activityLevel(3,now)===1,'a retrigger restarts at full brightness');advance(60);
 ok(c.activityUntil[0]===0&&c.activityUntil[15]===0&&c.activityUntil[3]>now,'retrigger extends only its own pulse');
 ok(tasks.some(t=>!t.dead&&t.due-now<=c.ACTIVITY_FRAME_MS),'fading LEDs redraw at animation rate');
 advance(80);ok(c.activityUntil.every(x=>x===0)&&c.pulseTask===null,'pulse expires and timer stops when idle');
 // The selected key is red: its LED keeps a dark bezel so the red flash stays visible.
 let fills=[];const draw=c.mgraphics;c.mgraphics=new Proxy({set_source_rgba:col=>fills.push(Array.from(col))},{get:(o,k)=>k in o?o[k]:(()=>{})});
 c.drawTrackLed(0,0,true,0);const idleSelected=fills.slice(1,2)[0];fills=[];c.drawTrackLed(0,0,true,1);const litSelected=fills.slice(1,2)[0];
 c.mgraphics=draw;
 ok(idleSelected[0]<0.5&&litSelected[0]>0.95&&litSelected[1]<0.4,'selected track LED flashes from dim to bright red');
 for(const bad of [0,-1,65536,1.5,NaN,Infinity,'1'])c.activity(bad);
 ok(c.activityUntil.every(x=>x===0)&&c.pulseTask===null,'invalid activity does not animate');
 c.audition(2);ok(outputs.length===1&&c.activityUntil.every(x=>x===0),'audition awaits actual native trigger');
 c.activity(65535);ok(c.activityUntil.every(x=>x>now),'all 16 tracks can light');
 c.state(JSON.stringify({ready:false}));advance(500);
 ok(c.activityUntil.every(x=>x===0)&&c.pulseTask===null,'not-ready state clears timers');
 c.activity(1);ok(c.activityUntil[0]===0,'not-ready engine cannot flash');
 vm.runInContext('model.ready=true;model.page=4;model.masterPage=0;',c);labels=[];c.drawLCD();
 ok(labels.some(s=>s.includes('REV on ROUTE')),'reverb page explains zero send');
 c.model.masterPage=1;labels=[];c.drawLCD();ok(labels.some(s=>s.includes('DEL on ROUTE')),'echo page explains zero send');
 c.activity(1);c.notifydeleted();advance(500);ok(c.activityUntil.every(x=>x===0)&&c.pulseTask===null,'deletion cleans pending activity');
}
console.log('PASS panel activity: '+checks+' assertions across compact and Editor panels');
