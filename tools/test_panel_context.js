// Cross-panel and host changes must not leave a gesture on a hidden parameter.
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'../device/md.panel.js'),'utf8');
let checks=0;
for(const editor of [false,true]){
 let outputs=[],labels=[];
 class Task{constructor(fn,ctx){this.fn=fn;this.ctx=ctx;}schedule(){}cancel(){}freepeer(){}}
 const g=new Proxy({text_measure:s=>[String(s).length*4,10],show_text:s=>labels.push(String(s))},{get:(o,k)=>k in o?o[k]:(()=>{})});
 const w=editor?1120:757,h=editor?250:169;
 const c={Task,mgraphics:g,box:{rect:[0,0,w,h]},jsarguments:['md.panel.js',editor?'editor':''],arrayfromargs:a=>Array.from(a),outlet:(...a)=>outputs.push(JSON.parse(JSON.stringify(a))),post:()=>{}};
 vm.createContext(c);vm.runInContext(source,c);
 function ok(v,label){assert(v,(editor?'Editor: ':'Compact: ')+label);checks++;}
 function start(){
  c.state(JSON.stringify({ready:true,status:'Ready',selected:0,page:0,masterPage:0,tracks:Array.from({length:16},(_,i)=>({machine:16,params:Array(24).fill(40+i),lfo:[i,0,0,0,0]})),master:Array.from({length:4},()=>Array(8).fill(64)),catalog:[{id:16,name:'TRX-BD',labels:['PTCH','DEC','RAMP','RDEC','STRT','NOIS','HARM','CLIP'],defaults:Array(8).fill(64)},{id:17,name:'TRX-SD',labels:Array(8).fill('SYN'),defaults:Array(8).fill(64)}]}));
  outputs=[];c.cancelGesture();c.chooser=false;
 }
 function click(x,y){c.onclick(x*w/1120,y*h/250,1,0,0,0,0,0);}
 function drag(x,y){c.ondrag(x*w/1120,y*h/250,1,0,0,0,0,0);}
 function wheel(x,y){c.onwheel(x*w/1120,y*h/250,0,1,0,0,0,0,0);}
 for(const change of ['track','page','machine','master','unready']){
  start();if(change==='master')c.state(JSON.stringify({page:4}));
  click(change==='master'?356:617,110);
  ok(!!c.drag,'gesture starts before '+change);
  const next=JSON.parse(JSON.stringify(c.model));
  if(change==='track')next.selected=1;
  if(change==='page')next.page=1;
  if(change==='machine')next.tracks[0].machine=17;
  if(change==='master')next.masterPage=1;
  if(change==='unready'){next.ready=false;next.status='OS file not found';}
  c.state(JSON.stringify(next));
  ok(c.drag===null&&c.focusKnob===-1,'remote '+change+' cancels old gesture and keyboard focus');
  const before=JSON.stringify(c.model);outputs=[];drag(617,90);c.key(38);
  ok(JSON.stringify(c.model)===before&&outputs.length===0,'no hidden write after '+change);
 }
 // DEL/REV live on ROUTE (knobs 3 and 4).
 start();c.state(JSON.stringify({page:2}));click(617,110);const same=JSON.parse(JSON.stringify(c.model));same.tracks[0].params[20]=99;c.state(JSON.stringify(same));
 ok(!!c.drag&&c.focusKnob===3,'ordinary automation feedback keeps current gesture alive');
 drag(617,100);ok(outputs.some(a=>a[1][0]==='action'&&a[1][1]==='setparam'&&a[1][2]===0&&a[1][3]===19),'gesture still writes intended send');
 start();c.state(JSON.stringify({page:2}));click(356,110);wheel(704,110);outputs=[];c.key(38);
 ok(c.focusKnob===4&&outputs.some(a=>a[1][1]==='setparam'&&a[1][3]===20),'wheel and keyboard share the last focused parameter');
 start();click(617,110);click(c.trackX(1)+10,210);outputs=[];drag(617,90);
 ok(c.drag===null&&outputs.length===0,'new track click cannot continue previous drag');
 start();c.openChooser();c.state(JSON.stringify({ready:false,status:'OS file not found'}));
 ok(!c.chooser,'engine failure dismisses chooser so error is visible');
 c.help='DEL 99';labels=[];c.drawLCD();
 ok(labels.includes('OS file not found')&&!labels.includes('DEL 99'),'control help cannot hide a loading failure');
 start();c.openChooser();const normal=JSON.parse(JSON.stringify(c.model));normal.tracks[0].params[19]=50;c.state(JSON.stringify(normal));
 ok(c.chooser,'parameter feedback does not dismiss machine chooser');
 c.notifydeleted();
}
console.log('PASS panel context: '+checks+' cross-panel, automation, gesture and error visibility checks');
