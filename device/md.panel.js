/* MD Drum Engine — vector faceplate for Max jsui / v8ui.
 * Intent: a musician shaping the selected drum; the red LCD is the focal point.
 * Silver, graphite and restrained red reflect the hardware. Recessed LCD and
 * lightly raised controls establish depth. Helvetica Neue labels / Menlo values,
 * a 4px rhythm and a 1120x250 working area keep the device legible inside Live.
 * Tracks select sounds, not steps. No synthetic meter, waveform or sequencer.
 * Input: state <JSON string>. Output: action <name> [arguments...].
 * Optional key <code> accepts a patcher key object; v8ui also calls onkeydown.
 */
autowatch = 1;
inlets = 1;
outlets = 1;
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;
var W=1120,H=250;
var isEditor=typeof jsarguments!=='undefined'&&String(jsarguments[1])==='editor';
// Helvetica Neue and Menlo are macOS fonts; Windows gets its closest system faces.
var isWindows=typeof max!=='undefined'&&String(max.os||'').toLowerCase().indexOf('win')===0;
var FONT_SANS=isWindows?'Segoe UI':'Helvetica Neue',FONT_MONO=isWindows?'Consolas':'Menlo',ALT_KEY=isWindows?'Alt':'Option';
var palette={
 frame:[0.16,0.17,0.18,1],plate:[0.73,0.74,0.74,1],plateTop:[0.79,0.80,0.80,1],plateBottom:[0.68,0.69,0.69,1],
 ink:[0.13,0.14,0.15,1],secondary:[0.30,0.31,0.32,1],muted:[0.42,0.43,0.44,1],line:[0.10,0.11,0.12,0.19],highlight:[1,1,1,0.36],
 graphite:[0.12,0.13,0.14,1],key:[0.19,0.20,0.21,1],white:[0.89,0.90,0.89,1],red:[0.72,0.13,0.11,1],led:[1,0.31,0.23,1],
 lcd:[0.77,0.20,0.16,1],lcdInk:[0.24,0.045,0.035,1],lcdQuiet:[0.35,0.07,0.05,1],overlay:[0.18,0.19,0.20,1]
};
var PAGES=['SYN','FX','ROUTE','LFO','MASTER'];
var FX_LABELS=['AMD','AMF','EQF','EQG','FLTF','FLTW','FLTQ','SRR'],FX_DEFAULTS=[0,0,64,64,0,127,0,0];
var ROUTE_LABELS=['DIST','VOL','PAN','DEL','REV','LFOS','LFOD','LFOM'],ROUTE_DEFAULTS=[0,100,64,0,0,64,0,0];
var MASTER_LABELS=[['DVOL','PRED','DEC','DAMP','HP','LP','GATE','LEV'],['TIME','MOD','MFRQ','FB','FLTF','FLTW','MONO','LEV'],['LF','LG','HF','HG','PF','PG','PQ','GAIN'],['ATCK','REL','TRHD','RTIO','KNEE','HP','OUTG','MIX']];
var MASTER_NAMES=['Reverb','Echo','EQ','Dynamics'],MASTER_ORDER=[1,0,2,3];
var LFO_LABELS=['DEST','PARAM','SHP1','SHP2','TYPE','SPD','DEP','MIX'],SHAPES=['TRI','SAW','SQR','LIN','EXP','RND'],LFO_TYPES=['FREE','TRIG','HOLD'];
var model={selected:0,page:0,masterPage:0,ready:false,status:'Select OS 1.63',firmware:'',gain:0.7,tracks:[],master:[],catalog:[]};
var hover='',drag=null,focusKnob=-1,chooser=false,family='ALL',menuPage=0,menuFocus=0,menuCols=8,menuRows=6,pulseTask=null,help='';
var stateRequestTask=null, panelContext=this;
// Independent short pulses confirm accepted notes, including simultaneous hits.
// Full brightness first, then a fade, so 16th-note hats still read as blinks.
var ACTIVITY_MS=130, ACTIVITY_HOLD_MS=45, ACTIVITY_FRAME_MS=30, activityUntil=[];
for(var activityIndex=0;activityIndex<16;activityIndex++)activityUntil.push(0);
function clearActivity(){
 if(pulseTask){pulseTask.cancel();if(pulseTask.freepeer)pulseTask.freepeer();pulseTask=null;}
 for(var i=0;i<16;i++)activityUntil[i]=0;
}
function expireActivity(){
 var now=new Date().getTime(),next=Infinity;
 for(var i=0;i<16;i++){if(activityUntil[i]<=now)activityUntil[i]=0;else next=Math.min(next,activityUntil[i]);}
 redraw();
 // Redraw at animation rate while any LED is still fading.
 if(next!==Infinity&&typeof Task!=='undefined'){
  pulseTask=new Task(function(){var old=pulseTask;pulseTask=null;expireActivity();if(old&&old.freepeer)old.freepeer();},panelContext);
  pulseTask.schedule(Math.max(1,Math.min(ACTIVITY_FRAME_MS,next-now)));
 }
}
// 1 right after a hit, fading to 0 when the pulse ends.
function activityLevel(t,now){
 var left=activityUntil[t]-now;if(left<=0)return 0;
 var age=ACTIVITY_MS-left;return age<=ACTIVITY_HOLD_MS?1:clamp(left/(ACTIVITY_MS-ACTIVITY_HOLD_MS),0,1);
}
function activity(mask){
 if(!model.ready||typeof mask!=='number'||!isFinite(mask)||mask!==Math.floor(mask)||mask<1||mask>65535)return;
 var until=new Date().getTime()+ACTIVITY_MS;
 for(var i=0;i<16;i++)if(mask&(1<<i))activityUntil[i]=until;
 if(pulseTask){pulseTask.cancel();if(pulseTask.freepeer)pulseTask.freepeer();pulseTask=null;}
 expireActivity();
}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function valid(v,fallback){return typeof v==='number'&&isFinite(v)?v:fallback;}
function pad(v){return(v<10?'0':'')+v;}
function selected(){return clamp(Math.round(valid(model.selected,0)),0,15);}
function page(){return clamp(Math.round(valid(model.page,0)),0,4);}
function trackAt(n){return model.tracks[n]||{machine:0,params:[],lfo:[]};}
function catalogFor(id){var list=model.catalog||[];for(var i=0;i<list.length;i++)if(Number(list[i].id)===Number(id))return list[i];return{id:id,name:id?('ID '+id):'GND---',labels:[],defaults:[]};}
function currentMachine(){return catalogFor(trackAt(selected()).machine);}
// Live names MIDI 60 C3, so our first trigger (36) is C1.
function triggerNoteLabel(track){var note=36+track,names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];return names[note%12]+(Math.floor(note/12)-2)+' · MIDI '+note;}
function emit(){var args=arrayfromargs(arguments);args.unshift('action');outlet(0,args);}
function redraw(){mgraphics.redraw();}
function editingContext(){return selected()+':'+page()+':'+(page()===4?model.masterPage:0)+':'+trackAt(selected()).machine;}
function cancelGesture(){drag=null;focusKnob=-1;help='';hover='';}
function state(){try{
 var incoming=JSON.parse(arrayfromargs(arguments).join(' '));if(!incoming||typeof incoming!=='object')return;
 var before=editingContext(),wasReady=model.ready;
 for(var k in incoming)if(incoming.hasOwnProperty(k))model[k]=incoming[k];
 if(!(model.catalog instanceof Array))model.catalog=[];if(!(model.tracks instanceof Array))model.tracks=[];if(!(model.master instanceof Array))model.master=[];
 // The other panel or host can change the selected track/machine mid-gesture.
 // Release the old descriptor rather than continue writing a hidden control.
 if(before!==editingContext()||(wasReady&&!model.ready)){cancelGesture();chooser=false;}
 if(!model.ready)clearActivity();redraw();
 }catch(err){post('md.panel: invalid state: '+err+'\n');}}
function bang(){redraw();}
// autowatch recompiles this script and clears its model without reloading the
// bridge. Request the authoritative state after patch cords are connected.
function requestStateSoon(){
 if(stateRequestTask){stateRequestTask.cancel();if(stateRequestTask.freepeer)stateRequestTask.freepeer();stateRequestTask=null;}
 if(typeof Task==='undefined'){emit('requeststate');return;}
 stateRequestTask=new Task(function(){
  var task=stateRequestTask;stateRequestTask=null;emit('requeststate');
  if(task&&task.freepeer)task.freepeer();
 },this);
 stateRequestTask.schedule(100);
}
function loadbang(){redraw();requestStateSoon();}
function onresize(){redraw();}
function rgba(color){mgraphics.set_source_rgba(color);}
function rect(x,y,w,h,color){rgba(color);mgraphics.rectangle(x,y,w,h);mgraphics.fill();}
function roundrect(x,y,w,h,r,color){rgba(color);mgraphics.rectangle_rounded(x,y,w,h,r,r);mgraphics.fill();}
function line(x1,y1,x2,y2,color,width){rgba(color);mgraphics.set_line_width(width||1);mgraphics.move_to(x1,y1);mgraphics.line_to(x2,y2);mgraphics.stroke();}
function circle(x,y,r,color){rgba(color);mgraphics.ellipse(x-r,y-r,2*r,2*r);mgraphics.fill();}
function font(size,mono,bold){mgraphics.select_font_face(mono?FONT_MONO:FONT_SANS,'normal',bold?'bold':'normal');mgraphics.set_font_size(size);}
function text(str,x,y,size,color,mono,bold,align){str=String(str);font(size,mono,bold);rgba(color);var tw=mgraphics.text_measure(str)[0];if(align==='center')x-=tw/2;if(align==='right')x-=tw;mgraphics.move_to(x,y);mgraphics.show_text(str);}
function fit(str,maxWidth,size,mono,bold){str=String(str);font(size,mono,bold);if(mgraphics.text_measure(str)[0]<=maxWidth)return str;while(str.length&&mgraphics.text_measure(str+'…')[0]>maxWidth)str=str.slice(0,-1);return str+'…';}
function triangle(x,y,dir,color){rgba(color);mgraphics.move_to(x,y);if(dir==='down'){mgraphics.line_to(x+8,y);mgraphics.line_to(x+4,y+4);}else if(dir==='right'){mgraphics.line_to(x,y+8);mgraphics.line_to(x+6,y+4);}else{mgraphics.line_to(x+6,y+4);mgraphics.line_to(x+6,y-4);}mgraphics.close_path();mgraphics.fill();}
function controlButton(id,label,x,y,w,h,dark,active,size){var over=hover===id;var fill=active?palette.red:dark?(over?[0.25,0.26,0.27,1]:palette.key):(over?[0.84,0.85,0.85,1]:[0.72,0.73,0.73,1]);roundrect(x,y+1,w,h,3,[0,0,0,0.16]);roundrect(x,y,w,h,3,fill);line(x+4,y+0.5,x+w-4,y+0.5,[1,1,1,dark?0.13:0.33]);text(label,x+w/2,y+h/2+(size||10)/2-1.5,size||10,dark||active?palette.white:palette.ink,false,true,'center');}
function knobX(i){return 356+i*87;}
function trackX(i){return 24+i*61+Math.floor(i/4)*4;}
function paramLabel(index,target){if(index<8)return(catalogFor(trackAt(target).machine).labels||[])[index]||('SYN'+(index+1));if(index<16)return FX_LABELS[index-8];return ROUTE_LABELS[index-16];}
function descriptor(i){
 var p=page(),t=selected(),tr=trackAt(t),machine=currentMachine();
 var d={kind:'param',track:t,index:i,min:0,max:127,value:0,def:0,label:'',enabled:true};
 if(p===0){d.label=(machine.labels||[])[i]||'';d.def=valid((machine.defaults||[])[i],0);d.enabled=!!d.label;}
 else if(p===1){d.index=i+8;d.label=FX_LABELS[i];d.def=FX_DEFAULTS[i];}
 else if(p===2){d.index=i+16;d.label=ROUTE_LABELS[i];d.def=ROUTE_DEFAULTS[i];}
 else if(p===3){d.label=LFO_LABELS[i];if(i<5){d.kind='lfo';d.max=[15,23,5,5,2][i];d.def=i===0?t:0;}else{d.index=i+16;d.def=i===5?64:0;}}
 else{d.kind='master';d.group=clamp(Math.round(valid(model.masterPage,0)),0,3);d.label=MASTER_LABELS[d.group][i];d.def=valid(model.masterDefaults&&model.masterDefaults[d.group]&&model.masterDefaults[d.group][i],0);}
 if(d.kind==='param')d.value=valid((tr.params||[])[d.index],d.def);else if(d.kind==='lfo')d.value=valid((tr.lfo||[])[d.index],d.def);else d.value=valid((model.master[d.group]||[])[d.index],d.def);
 d.value=clamp(d.value,d.min,d.max);return d;
}
function valueText(d){var v=Math.round(d.value);if(d.kind==='gain')return d.value<=0?'−∞ dB':((20*Math.log(d.value)/Math.LN10).toFixed(1)+' dB');if(d.kind==='lfo'){if(d.index===0)return'T'+pad(v+1);if(d.index===1)return paramLabel(v,valid((trackAt(d.track).lfo||[])[0],d.track));if(d.index===2)return SHAPES[v];if(d.index===3)return'I'+SHAPES[v];if(d.index===4)return LFO_TYPES[v];}if(d.kind==='param'&&d.index===18)return v===64?'C':((v<64?'L':'R')+Math.abs(v-64));return String(v);}
function gainDescriptor(){return{kind:'gain',label:'OUTPUT',value:clamp(valid(model.gain,0.7),0,1),min:0,max:1,def:0.7,enabled:true};}
function controlDescriptor(id){if(id==='gain')return gainDescriptor();return descriptor(parseInt(id.slice(4),10));}
function controlFocusIndex(id){return id==='gain'?8:parseInt(id.slice(4),10);}
function focusedDescriptor(){return focusKnob===8?gainDescriptor():descriptor(focusKnob);}
// Ask the host to focus the permanent Live parameter behind this drawn control.
// This is separate from value changes so a plain click can be used for LFO Map.
function focusParameter(d){if(d.enabled)emit('focusparam',d.kind,d.track||0,d.group||0,d.index||0);}
function updateValue(d,v){
 if(!d.enabled)return;v=clamp(v,d.min,d.max);if(d.kind!=='gain')v=Math.round(v);if(v===d.value)return;d.value=v;
 if(d.kind==='gain'){model.gain=v;emit('gain',v);}
 else if(d.kind==='lfo'){if(!model.tracks[d.track])return;if(!model.tracks[d.track].lfo)model.tracks[d.track].lfo=[];model.tracks[d.track].lfo[d.index]=v;emit('setlfo',d.track,d.index,v);}
 else if(d.kind==='master'){if(!model.master[d.group])model.master[d.group]=[];model.master[d.group][d.index]=v;emit('setmaster',d.group,d.index,v);}
 else{if(!model.tracks[d.track])return;if(!model.tracks[d.track].params)model.tracks[d.track].params=[];model.tracks[d.track].params[d.index]=v;emit('setparam',d.track,d.index,v);}
 help=d.label+'  '+valueText(d);redraw();
}
function drawKnob(d,x,y,r,active){
 if(!d.enabled){circle(x,y,r,[0.48,0.49,0.49,0.25]);text('—',x,y+4,12,palette.muted,true,false,'center');return;}
 var minAngle=Math.PI*0.75,maxAngle=Math.PI*2.25,angle=minAngle+(maxAngle-minAngle)*(d.value-d.min)/(d.max-d.min);
 rgba([0.20,0.21,0.22,0.24]);mgraphics.set_line_width(2);mgraphics.arc(x,y,r+5,minAngle,maxAngle);mgraphics.stroke();
 if(active||drag&&drag.descriptor.label===d.label){rgba(palette.red);mgraphics.set_line_width(2);mgraphics.arc(x,y,r+5,minAngle,angle);mgraphics.stroke();}
 circle(x,y+2,r+1,[0,0,0,0.18]);circle(x,y,r,[0.08,0.09,0.10,1]);circle(x,y-0.7,r-1.2,[0.38,0.39,0.40,1]);circle(x,y+0.5,r-2,[0.12,0.13,0.14,1]);circle(x,y-0.5,r-3,[0.21,0.22,0.23,1]);circle(x,y-1.2,r-5,[0.23,0.24,0.25,1]);
 line(x+Math.cos(angle)*(r*0.46),y+Math.sin(angle)*(r*0.46),x+Math.cos(angle)*(r-4),y+Math.sin(angle)*(r-4),palette.white,2);
}
function drawLogo(){line(23,12,40,12,palette.ink,1.5);line(23,23,40,23,palette.ink,1.5);line(23,12,23,23,palette.ink,1.5);line(40,12,40,23,palette.ink,1.5);line(28,12,28,23,palette.ink);line(35,12,35,23,palette.ink);line(23,17.5,40,17.5,palette.ink);text('MD',51,25,22,palette.ink,false,true);text('DRUM ENGINE',99,24,10,palette.secondary,false,true);}
function drawLCD(){
 var t=selected(),machine=currentMachine();
 roundrect(22,46,284,128,6,[1,1,1,0.4]);roundrect(23,47,282,126,5,[0.22,0.23,0.24,1]);roundrect(26,50,276,120,4,[0.075,0.08,0.085,1]);roundrect(31,55,266,110,3,palette.lcd);line(35,56,293,56,[0.95,0.38,0.29,0.4]);
 text('TRACK '+pad(t+1),43,74,9,palette.lcdQuiet,true,true);text(triggerNoteLabel(t),285,74,9,palette.lcdQuiet,true,false,'right');
 text(fit(machine.name,220,25,true,true),43,105,25,palette.lcdInk,true,true);triangle(278,91,'down',palette.lcdInk);
 if(hover==='machine')line(43,111,286,111,[0.25,0.035,0.025,0.5]);line(43,120,285,120,[0.25,0.035,0.025,0.2]);
 var statusText=String(model.status||(model.ready?'Ready':'Select OS 1.63'));if(model.ready&&page()===4&&(model.masterPage===0||model.masterPage===1)){var send=model.masterPage===0?'REV':'DEL',sendIndex=model.masterPage===0?20:19;if(!valid(trackAt(t).params[sendIndex],0))statusText='Raise '+send+' on ROUTE to hear '+(model.masterPage===0?'reverb':'echo');}text(fit((model.ready&&(help||hoverHint()))||statusText,238,10,false,false),43,138,10,palette.lcdInk,false,false);
 if(model.ready){triangle(44,147,'right',palette.lcdInk);text('Audition',58,155,9,palette.lcdInk,false,true);text(PAGES[page()]+(page()===4?' / '+MASTER_NAMES[model.masterPage||0]:''),285,155,9,palette.lcdQuiet,true,false,'right');}
 else text(fit(model.statusDetail||'Load your OS .syx to begin',238,9,false,false),43,155,9,palette.lcdQuiet,false,false);
}
function drawPages(){
 for(var p=0;p<5;p++){var x=327+p*70,active=page()===p;text(PAGES[p],x+25,58,10,active?palette.ink:(hover==='page'+p?palette.ink:palette.secondary),false,true,'center');if(active)roundrect(x+3,66,44,3,1,palette.red);}
 line(327,70,1007,70,palette.line);
 if(page()===4){for(var i=0;i<4;i++){var g=MASTER_ORDER[i];controlButton('master'+g,MASTER_NAMES[g],696+i*78,44,73,20,false,model.masterPage===g,9);}}
 else text(page()===0?'Synthesis':page()===1?'Track effects':page()===2?'Routing & LFO amount':'Low-frequency oscillator',1006,58,10,palette.secondary,false,false,'right');
 for(var k=0;k<8;k++){var d=descriptor(k),xk=knobX(k);drawKnob(d,xk,110,24,hover==='knob'+k||focusKnob===k);text(d.label||'—',xk,152,10,d.enabled?palette.ink:palette.muted,true,true,'center');text(d.enabled?valueText(d):'',xk,169,12,palette.secondary,true,false,'center');}
}
// The key's LED sits in a dark bezel: dim red marks the selected track, and
// every accepted MIDI/Audition hit flashes it bright red, selected or not.
function drawTrackLed(x,y,active,level){
 circle(x,y,5.2,[0.05,0.05,0.06,1]);
 var off=active?[0.42,0.07,0.05,1]:[0.22,0.12,0.11,1],c=[];
 for(var k=0;k<3;k++)c[k]=off[k]+(palette.led[k]-off[k])*level;c[3]=1;
 circle(x,y,3.9,c);
 if(level>0){circle(x,y,9,[palette.led[0],palette.led[1],palette.led[2],0.30*level]);circle(x,y,6.5,[palette.led[0],palette.led[1],palette.led[2],0.35*level]);circle(x-1,y-1,1.4,[1,0.85,0.8,0.9*level]);}
}
// A five-pip die: per-track randomize on each key, Random All in the top bar.
function drawDie(x,y,size,face,pip){
 roundrect(x,y,size,size,size*0.22,face);
 var r=Math.max(0.8,size*0.09),a=size*0.27,b=size*0.5,c=size*0.73;
 circle(x+a,y+a,r,pip);circle(x+c,y+a,r,pip);circle(x+b,y+b,r,pip);circle(x+a,y+c,r,pip);circle(x+c,y+c,r,pip);
}
var DIE_X=21,DIE_Y=198,DIE_SIZE=11;
function drawTrackDie(x,t,active){
 var over=hover==='dice'+t&&model.ready;
 var face=active?(over?[0.62,0.12,0.09,1]:[0.48,0.08,0.06,1]):(over?[0.46,0.47,0.48,1]:[0.29,0.30,0.31,1]);
 drawDie(x+DIE_X+1.5,DIE_Y+1.5,DIE_SIZE-3,face,model.ready?[0.93,0.93,0.92,over?1:0.85]:[0.6,0.6,0.6,0.4]);
}
// Top bar: kit files next to the logo; dice, Undo and Reset before READY.
var LOAD_KIT=[196,9,74,22],SAVE_KIT=[276,9,74,22],RANDOM_ALL=[686,9,26,22],UNDO=[716,9,40,22],RESET=[760,9,40,22];
function barButton(id,label,r,enabled){
 var over=hover===id&&enabled;
 roundrect(r[0],r[1]+1,r[2],r[3],3,[0,0,0,0.16]);roundrect(r[0],r[1],r[2],r[3],3,over?[0.84,0.85,0.85,1]:[0.72,0.73,0.73,1]);line(r[0]+4,r[1]+0.5,r[0]+r[2]-4,r[1]+0.5,[1,1,1,0.33]);
 if(label)text(label,r[0]+r[2]/2,r[1]+15,10,enabled?palette.ink:palette.muted,false,true,'center');
}
function drawTopButtons(){
 var on=!!model.ready;
 barButton('loadkit','Load Kit…',LOAD_KIT,true);barButton('savekit','Save Kit…',SAVE_KIT,true);
 barButton('randomall','',RANDOM_ALL,on);drawDie(RANDOM_ALL[0]+6,RANDOM_ALL[1]+4,14,on?palette.ink:[0.45,0.46,0.47,1],[0.9,0.9,0.89,1]);
 barButton('undo','Undo',UNDO,on&&!!model.canUndo);barButton('reset','Reset',RESET,on);
}
function hoverHint(){
 if(hover.indexOf('dice')===0)return'Roll T'+pad(parseInt(hover.slice(4),10)+1)+' sound · mix and sends stay';
 if(hover==='randomall')return'Random All · roll the sound of all 16 tracks';
 if(hover==='undo')return model.canUndo?'Undo the last dice, Reset or kit load':'Nothing to undo';
 if(hover==='reset')return'Reset to the default kit · Undo restores';
 if(hover==='loadkit')return'Load a kit file (.mdkit)';
 if(hover==='savekit')return'Save this kit to a file (.mdkit)';
 return'';
}
function drawTracks(){
 line(23,184,1097,184,palette.line);line(23,185,1097,185,[1,1,1,0.28]);
 var now=new Date().getTime();
 for(var t=0;t<16;t++){var x=trackX(t),active=selected()===t,level=activityLevel(t,now);var fill=active?palette.red:(hover==='track'+t?[0.25,0.26,0.27,1]:palette.key);roundrect(x-1,195,54,34,4,[0.3,0.31,0.32,0.45]);roundrect(x,196,52,32,3,[0.07,0.08,0.09,1]);roundrect(x+1,196,50,29,3,fill);line(x+5,197,x+47,197,[1,1,1,0.14]);drawTrackLed(x+42,205,active,level);drawTrackDie(x,t,active);text(pad(t+1),x+9,207,10,palette.white,true,true);var name=catalogFor(trackAt(t).machine).name;text(fit(name,44,7.5,true,false),x+26,220,7.5,active?[1,0.82,0.78,1]:[0.66,0.68,0.68,1],true,false,'center');}
 text('TRACKS',25,243,8,palette.secondary,false,true);text('Click to select · '+ALT_KEY+'-click to audition · Dice randomizes the sound',73,243,8,palette.secondary,false,false);text('Drag to turn · Shift for fine · Double-click to reset',1007,243,8,palette.secondary,false,false,'right');
}
function paint(){
 var bw=box.rect[2]-box.rect[0],bh=box.rect[3]-box.rect[1];if(bw<=0||bh<=0)return;mgraphics.save();mgraphics.scale(bw/W,bh/H);rect(0,0,W,H,palette.frame);roundrect(3,3,W-6,H-6,5,palette.plate);
 // Low-contrast material shading; vectors remain sharp at Retina scale.
 for(var row=4;row<H-4;row++){var q=(row-4)/(H-8),rgb=[];for(var c=0;c<3;c++)rgb[c]=palette.plateTop[c]*(1-q)+palette.plateBottom[c]*q;rgb[3]=1;rect(4,row,W-8,1,rgb);}
 line(8,4,W-8,4,palette.highlight);line(4,35,W-4,35,palette.line);line(4,36,W-4,36,palette.highlight);drawLogo();drawTopButtons();
 circle(870,20,3,model.ready?palette.red:palette.muted);text(model.ready?'READY':'OS REQUIRED',856,23,8,palette.secondary,true,false,'right');controlButton('firmware',model.ready?'Change OS…':'Load OS 1.63…',886,9,128,22,false,false,10);if(isEditor)text('M4L / 01',1096,23,9,palette.secondary,true,false,'right');else controlButton('editor','Editor',1028,9,68,22,false,false,10);
 drawLCD();drawPages();line(1031,49,1031,173,palette.line);var out=gainDescriptor();text('OUTPUT',1068,60,9,palette.ink,false,true,'center');drawKnob(out,1068,110,21,hover==='gain'||focusKnob===8);text(valueText(out),1068,151,10,palette.secondary,true,false,'center');text('STEREO',1068,169,8,palette.muted,true,false,'center');drawTracks();controlButton('panic','Panic',1040,199,56,25,false,false,9);if(chooser)drawChooser();mgraphics.restore();
}
function familyOf(name){name=String(name);if(name.indexOf('P-I')===0)return'P-I';var cut=name.indexOf('-');return cut<0?name:name.slice(0,cut);}
function families(){var arr=['ALL'],preferred=['TRX','EFM','E12','P-I','GND','INP','ROM','RAM','CTR','MID'],known={},list=model.catalog||[];for(var i=0;i<list.length;i++)known[familyOf(list[i].name)]=true;for(var j=0;j<preferred.length;j++)if(known[preferred[j]]){arr.push(preferred[j]);delete known[preferred[j]];}for(var k in known)if(known.hasOwnProperty(k))arr.push(k);return arr;}
function filteredCatalog(){var out=[],list=model.catalog||[];for(var i=0;i<list.length;i++)if(family==='ALL'||familyOf(list[i].name)===family)out.push(list[i]);return out;}
function pageCount(){return Math.max(1,Math.ceil(filteredCatalog().length/(menuRows*menuCols)));}
function drawChooser(){
 rect(4,36,W-8,H-40,[0.07,0.08,0.09,0.72]);roundrect(18,40,1084,198,7,[0,0,0,0.25]);roundrect(18,38,1084,198,7,palette.overlay);text('CHOOSE MACHINE',32,58,11,palette.white,false,true);text('Track '+pad(selected()+1),185,58,10,[0.65,0.67,0.68,1],true,false);controlButton('close','Close',1030,47,56,20,true,false,9);
 var fs=families();for(var f=0;f<fs.length;f++)controlButton('family'+f,fs[f],32+f*61,71,55,21,true,family===fs[f],9);
 var list=filteredCatalog(),per=menuRows*menuCols;menuPage=clamp(menuPage,0,pageCount()-1);if(!list.length)text('Load the OS file to read its machine catalog.',40,138,13,[0.7,0.71,0.72,1],false,false);
 for(var i=0;i<per;i++){var index=menuPage*per+i;if(index>=list.length)break;var col=i%menuCols,row=Math.floor(i/menuCols),item=list[index],x=32+col*132,y=102+row*18;var active=Number(item.id)===Number(trackAt(selected()).machine),over=hover==='item'+index;if(active||over||menuFocus===index)roundrect(x,y,124,17,3,active?palette.red:over?[0.32,0.33,0.34,1]:[0.24,0.25,0.26,1]);text(fit(item.name,108,10,true,false),x+8,y+12,10,active?palette.white:[0.78,0.80,0.80,1],true,false);}
 text(list.length+' machines',32,225,9,[0.56,0.58,0.59,1],false,false);text('Page '+(menuPage+1)+' / '+pageCount(),923,225,9,[0.64,0.66,0.67,1],true,false,'right');controlButton('prev','Previous',936,212,71,18,true,false,8);controlButton('next','Next',1015,212,71,18,true,false,8);
}
function localPoint(x,y){return[x*W/Math.max(1,box.rect[2]-box.rect[0]),y*H/Math.max(1,box.rect[3]-box.rect[1])];}
function contains(x,y,rx,ry,rw,rh){return x>=rx&&x<rx+rw&&y>=ry&&y<ry+rh;}
function hit(x,y){
 var i;
 if(chooser){if(contains(x,y,1030,47,56,20))return'close';var fs=families();for(i=0;i<fs.length;i++)if(contains(x,y,32+i*61,71,55,21))return'family'+i;if(contains(x,y,936,212,71,18))return'prev';if(contains(x,y,1015,212,71,18))return'next';var list=filteredCatalog(),per=menuRows*menuCols;for(i=0;i<per;i++){var index=menuPage*per+i;if(index>=list.length)break;if(contains(x,y,32+(i%menuCols)*132,102+Math.floor(i/menuCols)*18,124,17))return'item'+index;}return contains(x,y,18,38,1084,198)?'menu':'outside';}
 var bar={loadkit:LOAD_KIT,savekit:SAVE_KIT,randomall:RANDOM_ALL,undo:UNDO,reset:RESET};
 for(var b in bar)if(bar.hasOwnProperty(b)&&contains(x,y,bar[b][0],bar[b][1],bar[b][2],bar[b][3]))return b;
 if(!isEditor&&contains(x,y,1028,9,68,22))return'editor';if(contains(x,y,886,9,128,22))return'firmware';if(contains(x,y,34,78,260,37))return'machine';if(contains(x,y,39,144,84,16)&&model.ready)return'audition';if(contains(x,y,1040,199,56,25))return'panic';if(contains(x,y,1040,76,56,84))return'gain';
 for(i=0;i<5;i++)if(contains(x,y,327+i*70,42,62,30))return'page'+i;
 if(page()===4)for(i=0;i<4;i++)if(contains(x,y,696+i*78,44,73,20))return'master'+MASTER_ORDER[i];
 for(i=0;i<8;i++)if(contains(x,y,knobX(i)-34,77,68,98)&&descriptor(i).enabled)return'knob'+i;
 // Die target = the icon itself (about 7x9 px compact) so key clicks still select.
 for(i=0;i<16;i++)if(contains(x,y,trackX(i)+DIE_X,DIE_Y-2,DIE_SIZE+1,DIE_SIZE+2))return'dice'+i;
 for(i=0;i<16;i++)if(contains(x,y,trackX(i)-2,193,56,38))return'track'+i;return'';
}
function audition(n){if(model.ready)emit('audition',n,100);}
function openChooser(){chooser=true;family='ALL';menuPage=0;menuFocus=0;var list=filteredCatalog();for(var i=0;i<list.length;i++)if(Number(list[i].id)===Number(trackAt(selected()).machine)){menuFocus=i;menuPage=Math.floor(i/(menuRows*menuCols));break;}drag=null;redraw();}
function choose(index){var item=filteredCatalog()[index];if(!item)return;chooser=false;help='';emit('setmachine',selected(),Number(item.id));redraw();}
function onclick(x,y,button,mod1,shift,caps,opt,mod2){
 var p=localPoint(x,y),id=hit(p[0],p[1]);hover=id;help='';focusKnob=-1;drag=null;
 if(chooser){if(id==='close'||id==='outside')chooser=false;else if(id.indexOf('family')===0){family=families()[parseInt(id.slice(6),10)]||'ALL';menuPage=0;menuFocus=0;}else if(id==='prev'){menuPage=clamp(menuPage-1,0,pageCount()-1);menuFocus=menuPage*menuCols*menuRows;}else if(id==='next'){menuPage=clamp(menuPage+1,0,pageCount()-1);menuFocus=menuPage*menuCols*menuRows;}else if(id.indexOf('item')===0)choose(parseInt(id.slice(4),10));redraw();return;}
 if(id==='editor')emit('openeditor');else if(id==='firmware')emit('loadfirmware');else if(id==='machine')openChooser();else if(id==='audition')audition(selected());else if(id==='panic')emit('panic');
 else if(id==='randomall'){if(model.ready)emit('randomall');}
 else if(id==='undo'){if(model.ready&&model.canUndo)emit('undo');}
 else if(id==='reset'){if(model.ready)emit('resetkit');}
 else if(id==='loadkit')emit('loadkit');else if(id==='savekit')emit('savekit');
 else if(id.indexOf('dice')===0){if(model.ready)emit('random',parseInt(id.slice(4),10));}
 else if(id.indexOf('track')===0){var t=parseInt(id.slice(5),10);model.selected=t;emit('selecttrack',t);if(opt)audition(t);}
 else if(id.indexOf('page')===0){model.page=parseInt(id.slice(4),10);emit('selectpage',model.page);}
 else if(id.indexOf('master')===0){model.masterPage=parseInt(id.slice(6),10);emit('selectmaster',model.masterPage);}
 else if(id.indexOf('knob')===0||id==='gain'){focusKnob=controlFocusIndex(id);var d=controlDescriptor(id);focusParameter(d);drag={descriptor:d,lastY:p[1],raw:d.value};help=d.label+'  '+valueText(d);}
 redraw();
}
function ondrag(x,y,button,mod1,shift,caps,opt,mod2){if(!drag)return;var p=localPoint(x,y),d=drag.descriptor;if(button){drag.raw=clamp(drag.raw+(drag.lastY-p[1])*(d.max-d.min)/140*(shift?0.1:1),d.min,d.max);updateValue(d,drag.raw);drag.lastY=p[1];}else{drag=null;redraw();}}
function ondblclick(x,y,button,mod1,shift,caps,opt,mod2){if(chooser)return;var p=localPoint(x,y),id=hit(p[0],p[1]);if(id.indexOf('knob')===0||id==='gain'){focusKnob=controlFocusIndex(id);var d=controlDescriptor(id);focusParameter(d);updateValue(d,d.def);drag=null;}}
function onidle(x,y){var p=localPoint(x,y),next=hit(p[0],p[1]);if(next!==hover){hover=next;redraw();}}
function onidleout(){hover='';if(!drag)help='';redraw();}
function onwheel(x,y,scrollx,scrolly,mod1,shift,caps,opt,mod2){if(!scrolly)return;if(chooser){menuPage=clamp(menuPage+(scrolly<0?1:-1),0,pageCount()-1);menuFocus=menuPage*menuCols*menuRows;redraw();return;}var p=localPoint(x,y),id=hit(p[0],p[1]);if(id.indexOf('knob')===0||id==='gain'){focusKnob=controlFocusIndex(id);var d=controlDescriptor(id);focusParameter(d);updateValue(d,d.value+(scrolly>0?1:-1)*(d.kind==='gain'?(shift?0.001:0.01):1));}}
function key(code){
 code=Number(code);
 if(chooser){if(code===27)chooser=false;else if(code===13||code===10)choose(menuFocus);else if(code===28||code===37)menuFocus--;else if(code===29||code===39)menuFocus++;else if(code===30||code===38)menuFocus-=menuCols;else if(code===31||code===40)menuFocus+=menuCols;else return 0;menuFocus=clamp(menuFocus,0,Math.max(0,filteredCatalog().length-1));menuPage=Math.floor(menuFocus/(menuCols*menuRows));redraw();return 1;}
 if(code===27){drag=null;focusKnob=-1;help='';redraw();return 1;}
 if(focusKnob>=0&&(code===30||code===38||code===31||code===40)){var d=focusedDescriptor();updateValue(d,d.value+((code===30||code===38)?1:-1)*(d.kind==='gain'?0.01:1));return 1;}return 0;
}
function onkeydown(keycode,textcharacter,updown,mod1,shift,caps,opt,mod2){return key(keycode);}

function notifydeleted(){
 clearActivity();
 if(stateRequestTask){stateRequestTask.cancel();if(stateRequestTask.freepeer)stateRequestTask.freepeer();stateRequestTask=null;}
}
requestStateSoon();
