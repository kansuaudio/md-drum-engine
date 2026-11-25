#!/usr/bin/env node
'use strict';
// Exercise the actual Max bridge with a deterministic scheduler and engine boundary.
// No Max, firmware, audio output, or third-party JavaScript packages are required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../device/md.bridge.js'), 'utf8');
let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }
function equal(actual, expected, message) { checks++; assert.deepEqual(actual, expected, message); }
function makeHost(environment = {os:'macintosh',arch:'arm64'}) {
    let time=0, order=0;
    const tasks=[], events=[], posts=[];
    const context={
        max:environment,
        patcher:{getnamed(){return null;}},
        post(text){posts.push(String(text));},
        outlet(outlet,args){events.push({time,outlet,args:Array.from(args)});},
        Task:function(callback,scope){
            this.cancelled=false;this.freed=false;
            this.schedule=delay=>tasks.push({time:time+delay,order:order++,task:this,callback:()=>callback.call(scope)});
            this.cancel=()=>{this.cancelled=true;};
            this.freepeer=()=>{this.freed=true;};
        }
    };
    vm.createContext(context);vm.runInContext(source,context,{filename:'md.bridge.js'});
    function advance(ms) {
        const end=time+ms;
        while(true){
            tasks.sort((a,b)=>a.time-b.time||a.order-b.order);
            const next=tasks[0];if(!next||next.time>end)break;
            tasks.shift();time=next.time;
            if(!next.task.cancelled&&!next.task.freed)next.callback();
        }
        time=end;
    }
    function engineMessages(name){return events.filter(e=>e.outlet===0&&e.args[0]===name);}
    function acknowledge(){context.engine('engineinfo','1.0.1','arm64');advance(100);}
    return {context,advance,events,posts,tasks,engineMessages,acknowledge};
}
// Startup checks the native external even before a firmware file is selected.
{
    const h=makeHost();h.context.init();
    equal(h.engineMessages('ping').length,1,'init probes native engine');
    h.advance(1600);
    equal(h.context.engineAvailable,false,'missing core remains unavailable');
    equal(h.context.loading,false,'missing core cannot pretend to load a ROM');
    equal(h.context.engineStatus,'Engine unavailable — see Max Console','missing core has actionable status');
    ok(h.posts.some(s=>s.includes('Max Console')&&s.includes('missing or blocked')&&s.includes('Restart Live')),'console explains platform and loading failure');
    equal(h.engineMessages('firmware').length,0,'no firmware dispatch without handshake');
    h.context.dialogcancel();equal(h.context.engineStatus,'Engine unavailable — see Max Console','cancelled dialog preserves engine error');
    h.context.display();
    const model=JSON.parse(h.events.filter(e=>e.outlet===1&&e.args[0]==='state').at(-1).args[1]);
    ok(model.statusDetail.includes('macOS 12+'),'panel receives diagnostic detail');
}
// A preselected or restored firmware path waits for the native acknowledgement.
{
    const h=makeHost();h.context.cfg.firmware='/Volumes/Drum Library/OS 1.63.syx';h.context.init();h.advance(200);
    equal(h.engineMessages('firmware').length,0,'restored firmware waits for native engine');
    equal(h.context.loading,false,'handshake is not a ROM load');
    h.acknowledge();
    equal(h.engineMessages('firmware').length,1,'acknowledgement starts one load');
    equal(h.engineMessages('firmware')[0].args[1],'/Volumes/Drum Library/OS 1.63.syx','complete external path reaches native engine');
    equal(h.context.loading,true,'load marked in flight');
    h.context.engine('ready',0);
    equal(h.context.loading,true,'native loading-start ready 0 preserves in-flight flag');
    const saved=Array.from(h.context.getvalueof());h.context.setvalueof(...saved);h.context.thisdeviceready();h.advance(200);
    equal(h.engineMessages('firmware').length,1,'duplicate state restore does not enqueue a second load');
    h.context.engine('ready',1);h.advance(2000);
    equal(h.context.engineReady,true,'ready is retained after watchdog deadline');
    equal(h.context.loading,false,'success completes load');
    equal(h.context.engineStatus,'OS 1.63 ready · MIDI 36–51','successful engine status retained');
    h.context.engine('engineinfo','1.0.1','arm64');h.advance(200);
    equal(h.engineMessages('firmware').length,1,'duplicate handshake is idempotent');
}
// An actual ROM error survives ready 0 and saved-state restoration; explicit retry works.
{
    const h=makeHost();h.context.init();h.acknowledge();h.context.firmwarepath('/Users/test/OS.syx');h.advance(100);
    h.context.engine('ready',0);h.context.engine('error','Could not read selected OS file');h.context.engine('ready',0);
    equal(h.context.engineStatus,'Could not read selected OS file','ready 0 preserves file error');
    equal(h.context.loading,false,'file error ends load');
    const saved=Array.from(h.context.getvalueof());h.context.setvalueof(...saved);h.advance(200);
    equal(h.engineMessages('firmware').length,1,'restoring same failed path does not silently retry');
    equal(h.context.engineStatus,'Could not read selected OS file','restore preserves file error');
    h.context.firmwarepath('/Users/test/OS.syx');h.advance(100);
    equal(h.engineMessages('firmware').length,2,'explicit selection retries same file');
    h.context.engine('error','first file failed');
    h.context.firmwarepath('/Users/test/Another OS.syx');h.advance(100);
    equal(h.engineMessages('firmware').length,3,'selecting different file can recover');
}
// Real Max conformpath native absolute returns Volume:/ paths. Legacy saved
// POSIX paths and direct callers are also preserved for the native SDK resolver.
for(const firmware of ['Macintosh HD:/Users/Test User/OS 1.63.syx','External SSD:/OS Library/OS 1.63.syx','Macintosh HD:/Users/音楽/サウンド/machine.syx','/Users/Test User/OS 1.63.syx','/Volumes/Drum SSD/ROMs/OS.syx','/Users/音楽/サウンド/machine.syx','/Volumes/音楽/OS.syx','C:\\Users\\Test User\\Downloads\\OS.syx','Drive:/OS.syx']){
    const h=makeHost();h.context.init();h.acknowledge();h.context.firmwarepath(firmware);h.advance(100);
    equal(h.context.cfg.firmware,firmware,'saved path is unchanged');
    equal(h.engineMessages('firmware')[0].args[1],firmware,'native dispatch preserves complete path');
}
// The conformpath result travels with its original path; failed conversion is explicit.
{
    const h=makeHost();h.context.init();h.acknowledge();
    h.context.firmwarepathchecked('Unresolved Volume:/OS.syx',0);h.advance(200);
    equal(h.engineMessages('firmware').length,0,'failed conversion cannot reach native loader');
    equal(h.context.cfg.firmware,'','failed conversion does not overwrite persisted path');
    equal(h.context.engineStatus,'Cannot resolve OS file path','conversion failure is visible');
    ok(h.posts.some(s=>s.includes('Unresolved Volume:/OS.syx')),'original failed path is retained in console');
    h.context.firmwarepathchecked('/Volumes/Resolved Volume/OS.syx',1);h.advance(100);
    equal(h.engineMessages('firmware')[0].args[1],'/Volumes/Resolved Volume/OS.syx','successful conversion recovers');
}
// Windows uses the embedded .mxe64 engine: the same native handshake as macOS.
for(const environment of [{os:'windows',arch:'x64'},{os:'windows',arch:'arm64'}]){
    const h=makeHost(environment);h.context.cfg.firmware='C:/Users/test/OS.syx';h.context.init();h.advance(100);
    equal(h.engineMessages('ping').length,1,'Windows is not rejected before handshake');
    equal(h.engineMessages('firmware').length,0,'Windows firmware waits for native acknowledgement');
    h.context.engine('engineinfo','1.0.4','x86_64');h.advance(100);
    equal(h.engineMessages('firmware').length,1,'Windows native acknowledgement starts load');
    equal(h.engineMessages('firmware')[0].args[1],'C:/Users/test/OS.syx','Windows path reaches the engine unchanged');
    h.context.engine('ready',1);h.advance(2000);
    equal(h.context.engineReady,true,'Windows engine reaches and retains ready');
}
// A Windows host without a loadable engine still explains itself instead of loading forever.
{
    const h=makeHost({os:'windows',arch:'arm64'});h.context.init();h.context.firmwarepath('C:/Users/test/OS.syx');h.advance(2000);
    equal(h.context.loading,false,'missing Windows engine never enters loading');
    equal(h.engineMessages('firmware').length,0,'missing Windows engine never dispatches firmware');
    ok(h.context.engineStatus.includes('Engine unavailable')&&h.context.engineStatusDetail.includes('Windows'),'missing engine status names both platforms');
}
// Universal macOS builds must prove native availability on Intel and Rosetta too.
for(const arch of ['x64','x86_64','x86']){
    const h=makeHost({os:'macintosh',arch});h.context.cfg.firmware='/Users/test/OS.syx';h.context.init();h.advance(100);
    equal(h.engineMessages('ping').length,1,'macOS architecture is not rejected before handshake');
    equal(h.engineMessages('firmware').length,0,'Intel firmware still waits for native acknowledgement');
    h.context.engine('engineinfo','1.0.1','x86_64');h.advance(100);
    equal(h.engineMessages('firmware').length,1,'Intel native acknowledgement starts load');
    h.context.engine('ready',1);h.advance(2000);
    equal(h.context.engineReady,true,'Intel engine reaches and retains ready');
}
// Unknown JS runtime metadata falls back to the real native handshake.
{
    const h=makeHost({});h.context.init();h.acknowledge();h.advance(2000);
    equal(h.context.engineAvailable,true,'unknown platform can prove native availability');
    equal(h.context.engineStatus,'Select OS 1.63','no ROM still prompts selection after successful handshake');
}
// A delayed reply or user retry can recover after a missing-engine diagnostic.
{
    const h=makeHost();h.context.init();h.context.firmwarepath('/Users/test/OS.syx');h.advance(1600);
    h.acknowledge();equal(h.engineMessages('firmware').length,1,'late valid handshake recovers queued file');
    const h2=makeHost();h2.context.init();h2.advance(1600);h2.context.firmwarepath('/Users/test/OS.syx');h2.advance(100);
    equal(h2.engineMessages('ping').length,2,'explicit retry requests fresh handshake');
    h2.acknowledge();equal(h2.engineMessages('firmware').length,1,'fresh handshake recovers');
}
// Do not claim a JS timer interrupts or times out a synchronous native ROM load.
{
    const h=makeHost();h.context.init();h.acknowledge();h.context.firmwarepath('/Users/test/OS.syx');h.advance(100000);
    equal(h.context.loading,true,'no fake native-load timeout');
    ok(!h.context.engineStatus.includes('unavailable'),'handshaken core is not later reported absent');
}
// Only confirmed native trigger activity reaches the panel; state and parameters stay untouched.
{
    const h=makeHost();h.context.init();h.acknowledge();h.context.engine('activity',1);
    equal(h.events.filter(e=>e.outlet===1&&e.args[0]==='activity').length,0,'activity before ready ignored');
    h.context.engine('ready',1);const before=JSON.stringify(Array.from(h.context.getvalueof()));
    for(const mask of [0,1,32768,65535])h.context.engine('activity',mask);
    equal(h.events.filter(e=>e.outlet===1&&e.args[0]==='activity').map(e=>e.args[1]),[0,1,32768,65535],'valid 16-bit masks forwarded');
    for(const mask of [-1,65536,0.5,NaN,Infinity,'1',null])h.context.engine('activity',mask);
    h.context.engine('activity',1,2);h.context.engine('activity');
    equal(h.events.filter(e=>e.outlet===1&&e.args[0]==='activity').length,4,'invalid masks rejected');
    equal(JSON.stringify(Array.from(h.context.getvalueof())),before,'activity never enters saved state');
}
// Device deletion cancels every timer, including a pending native handshake.
{
    const h=makeHost();h.context.init();h.context.notifydeleted();const count=h.events.length;h.advance(10000);
    equal(h.events.length,count,'deleted device emits nothing after timer cleanup');
    equal(h.posts.length,0,'deleted device never posts a stale loading error');
}
console.log(`PASS: ${checks} bridge loading, path, handshake and trigger activity checks`);
