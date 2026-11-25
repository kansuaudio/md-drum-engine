/* MD Drum Engine: host parameter, firmware and persistent-state bridge.
 * The MIDI performance path stays entirely in native Max objects; this JS is UI/control only.
 * Outputs: 0 mdcoreengine~ messages, 1 panel state, 2 master gain, 3 host/dialog actions.
 */
autowatch = 1;
inlets = 1;
outlets = 4;
// Capture the JSThis patcher once: Task callbacks do not preserve their caller's this.
var hostPatcher=this.patcher, hostContext=this;

var MACHINE_IDS = [1,2,3,16,17,18,19,20,21,22,23,24,25,26,27,28,32,33,34,35,36,37,38,39,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72];
var DEFAULT_IDS = [16,17,18,19,20,21,22,23,24,25,26,27,32,33,52,60];
var DEFAULT_SYN = [[64,64,0,0,0,0,0,0],[64,32,0,64,64,64,64,0],[64,48,48,102,64,0,0,0],[64,64,127,64,64,32,32,64],[64,32,0,0,0,0,0,0],[64,64,64,0,64,64,0,0],[32,32,64,64,64,0,0,0],[64,64,64,64,64,0,0,0],[64,64,64,64,64,64,0,0],[32,32,0,0,64,64,64,64],[64,32,64,0,64,0,0,0],[64,32,32,96,0,0,0,0],[36,76,64,55,64,64,32,127],[64,55,64,64,64,32,44,16],[64,127,0,0,0,0,64,64],[64,96,0,0,0,0,64,64]];
var DEFAULT_FX = [0,0,64,64,0,127,0,0,0,100,64,0,0,64,0,0];
var DEFAULT_MASTER = [[0,0,64,64,0,127,127,127],[24,0,0,32,0,127,0,127],[64,64,64,64,64,64,64,64],[0,64,127,0,0,0,64,0]];
var LFO_MAX = [15,23,5,5,2];
var cfg = freshState();
var catalog = [], engineReady = false, initialized = false, restoring = false;
var restoredState = false, loading = false, loadedPath = "", failedPath = "", hostTempo = 120;
var engineAvailable = false, handshakeWaiting = false, handshakeTask = null;
var engineVersion = "", engineArchitecture = "";
var engineStatus = "Select OS 1.63", engineStatusDetail = "", redrawTask = null, bootTask = null;
var controlObjects = {}, dirtySynth = {}, batchDepth = 0;
var liveDeviceReady=false, engineLatency=0, haveLatency=false, controlsDirty=true;
var latencyStatus="waiting", reportedLatency=null;
var lastUndo=null, noticeTask=null; // one-level kit snapshot for Undo

function freshState() {
    var state = {version:1,firmware:"",selected:0,page:0,masterPage:0,gain:0.7,tracks:[],master:[]};
    for (var t=0;t<16;t++) state.tracks.push({machine:DEFAULT_IDS[t],params:DEFAULT_SYN[t].concat(DEFAULT_FX),lfo:[t,0,0,0,0]});
    for (var g=0;g<4;g++) state.master.push(DEFAULT_MASTER[g].slice(0));
    return state;
}
function clamp(v,lo,hi,fallback) { var x=Number(v); return isFinite(x)?Math.max(lo,Math.min(hi,x)):fallback; }
function integer(v,lo,hi,fallback) { return Math.round(clamp(v,lo,hi,fallback)); }
function indexOK(v,n) { return isFinite(Number(v)) && Number(v)===Math.floor(Number(v)) && v>=0 && v<n; }
function two(v) { return v<10?"0"+v:String(v); }
function trackName(t,field,k) { return "md_t"+two(t+1)+"_"+field+(k===undefined?"":two(k+1)); }
function masterName(g,k) { return "md_master"+g+"_"+two(k+1); }
function emit(n,a) { outlet(n,a); }
function mark() { if(typeof notifyclients==="function")notifyclients(); }
function status(text,detail) { engineStatus=String(text);engineStatusDetail=detail?String(detail):"";redraw(); }
function setReady(value) { engineReady=!!value;emit(3,["ready",engineReady?1:0]); }
function cancelTask(t) { if(!t)return; t.cancel(); if(t.freepeer)t.freepeer(); }
function schedule(fn,delay) { var task=new Task(function(){try{fn();}finally{if(task.freepeer)task.freepeer();}},hostContext); task.schedule(delay); return task; }
function redraw() {
    if(batchDepth || redrawTask)return;
    redrawTask=schedule(function(){redrawTask=null;display();},25);
}
function display() {
    emit(1,["state",JSON.stringify({selected:cfg.selected,page:cfg.page,masterPage:cfg.masterPage,ready:engineReady,
        status:engineStatus,statusDetail:engineStatusDetail,firmware:cfg.firmware,gain:cfg.gain,tracks:cfg.tracks,master:cfg.master,masterDefaults:DEFAULT_MASTER,catalog:catalog,canUndo:!!lastUndo,latency:{samples:engineLatency,reported:reportedLatency,status:latencyStatus}})]);
}
function getControl(name) {
    if(!controlObjects[name])controlObjects[name]=hostPatcher.getnamed(name);
    return controlObjects[name];
}
// Numeric inlet messages update the actual native Live parameter. UI writes must
// never use `set`: that would make the picture move without recording automation.
function writeControl(name,value,silent) {
    var obj=getControl(name);
    if(!obj){status("Missing parameter: "+name);return false;}
    if(silent)obj.message("set",value);
    else obj.message(name==="md_gain"?"float":"int",value);
    return true;
}
// LiveAPI selected_parameter is read-only. The native focus helper uses the
// Max SDK to select this existing Live parameter, without writing its value.
function focusParameter(args) {
    if(args.length!==4)return;
    var kind=String(args[0]),t=args[1],g=args[2],k=args[3],name;
    if(typeof t!=="number"||typeof g!=="number"||typeof k!=="number"||
       !indexOK(t,16)||!indexOK(g,4))return;
    if(kind==="param"&&indexOK(k,24))name=trackName(t,"p",k);
    else if(kind==="lfo"&&indexOK(k,5))name=trackName(t,"lfo",k);
    else if(kind==="master"&&indexOK(k,8))name=masterName(g,k);
    else if(kind==="gain"&&t===0&&g===0&&k===0)name="md_gain";
    if(name)emit(3,["focusparameter",name]);
}
function machineIndex(id) { for(var i=0;i<MACHINE_IDS.length;i++)if(MACHINE_IDS[i]===id)return i; return -1; }
function machineInfo(id) { for(var i=0;i<catalog.length;i++)if(catalog[i].id===id)return catalog[i]; return null; }
function syncControl(name,value) {
    var obj=getControl(name);if(!obj)return;
    var current=obj.getvalueof();if(current instanceof Array)current=current[0];
    // Avoid touching unchanged host parameters and their automation state.
    if(isFinite(Number(current))&&Math.abs(Number(current)-value)<0.0000001)return;
    obj.message(name==="md_gain"?"float":"int",value);
}
function syncControls() {
    // loadbang can precede Live's preset restore. Only live.thisdevice tells us
    // its native parameters and hidden state have finished restoring.
    if(!liveDeviceReady){controlsDirty=true;return;}
    controlsDirty=false;
    var previous=restoring;restoring=true;
    try {
        for(var t=0;t<16;t++) {
            var tr=cfg.tracks[t];syncControl(trackName(t,"machine"),machineIndex(tr.machine));
            for(var p=0;p<24;p++)syncControl(trackName(t,"p",p),tr.params[p]);
            for(var l=0;l<5;l++)syncControl(trackName(t,"lfo",l),tr.lfo[l]);
        }
        for(var g=0;g<4;g++)for(var k=0;k<8;k++)syncControl(masterName(g,k),cfg.master[g][k]);
        syncControl("md_gain",cfg.gain);
    } finally {restoring=previous;}
    emit(2,[cfg.gain]);
}
function syncEngine() {
    if(!engineReady)return;
    // Queue a complete kit before allowing a new MIDI note to reach the engine.
    emit(3,["ready",0]);
    for(var t=0;t<16;t++) {
        var tr=cfg.tracks[t];emit(0,["machine",t,tr.machine]);
        for(var p=0;p<24;p++)emit(0,["param",t,p,tr.params[p]]);
        for(var l=0;l<5;l++)emit(0,["lfo",t,l,tr.lfo[l]]);
    }
    for(var g=0;g<4;g++)for(var k=0;k<8;k++)emit(0,["master",g,k,cfg.master[g][k]]);
    emit(0,["tempo",hostTempo]);emit(2,[cfg.gain]);emit(3,["ready",1]);
}
// The device embeds macOS (.mxo, arm64 + x86_64) and Windows (.mxe64, x64)
// engines. Other hosts (for example Windows on ARM without x64 emulation)
// surface as an unanswered handshake below.
function hostSupportError() { return ""; }
function engineUnavailable(reason) {
    handshakeWaiting=false;loading=false;setReady(false);
    status(reason||"Engine unavailable — see Max Console","macOS 12+ or Windows 10+ x64 · see Max Console");
    post("MD Drum Engine: "+(reason||"The native audio engine did not answer. This build requires macOS 12 or later, or 64-bit Windows 10 or later. The native external may be missing or blocked; open Max Console for its loading error. Restart Live after updating the device.")+"\n");
}
function requestEngine() {
    if(engineAvailable)return true;
    var unsupported=hostSupportError();
    if(unsupported){engineUnavailable(unsupported);return false;}
    if(handshakeWaiting)return false;
    handshakeWaiting=true;status("Checking audio engine…");
    // This detects an absent/unloadable external. A synchronous native load
    // blocks Max's low-priority thread, so a JS timer cannot interrupt that load.
    handshakeTask=schedule(function(){handshakeTask=null;if(!engineAvailable)engineUnavailable();},1500);
    emit(0,["ping"]);
    return engineAvailable;
}
function init() {
    if(initialized)return;
    initialized=true;display();requestEngine();scheduleBoot();
}
function scheduleBoot() {
    if(!initialized)return;
    cancelTask(bootTask);bootTask=schedule(function(){bootTask=null;boot();},100);
}
function boot() {
    if(!requestEngine())return;
    if(cfg.firmware) {
        if(engineReady && loadedPath===cfg.firmware){syncEngine();return;}
        if(loading && loadedPath===cfg.firmware)return;
        if(failedPath===cfg.firmware)return;
        setReady(false);loading=true;loadedPath=cfg.firmware;
        status("Loading OS 1.63…");emit(0,["firmware",cfg.firmware]);
    } else {loading=false;setReady(false);emit(0,["panic"]);status("Select OS 1.63");}
}
function firmwarepathchecked(path,converted) {
    if(converted!==1) {
        status("Cannot resolve OS file path","Select the unzipped .syx file again");
        post("MD Drum Engine: Max could not convert the selected OS path to a native absolute path: "+String(path)+"\n");
        return;
    }
    firmwarepath(path);
}
function firmwarepath() {
    var path=Array.prototype.slice.call(arguments).join(" ");
    // On macOS, conformpath native absolute still returns a Max Volume:/ path.
    // Preserve it (and legacy saved POSIX paths) unchanged; the native external
    // resolves Max paths through the SDK before opening the OS file.
    if(!path)return;
    // An explicit reload must stop the previous session before the deferred load.
    var wasReady=engineReady;setReady(false);if(wasReady)emit(0,["panic"]);
    cfg.firmware=path;loading=false;failedPath="";mark();scheduleBoot();redraw();
}
function dialogcancel() { if(engineAvailable&&!cfg.firmware)status("Select OS 1.63"); }
// The patcher latency attribute is measured in host samples. Wait until Live
// has restored/initialized the device, then update it whenever the core rate changes.
function thisdeviceready() {liveDeviceReady=true;applyLatency();if(controlsDirty)syncControls();scheduleBoot();}
function applyLatency() {
    if(!liveDeviceReady||!haveLatency)return;
    try{
        var before=hostPatcher.getattr("latency");if(before instanceof Array)before=before[0];
        if(Number(before)!==engineLatency)hostPatcher.setattr("latency",engineLatency);
        var actual=hostPatcher.getattr("latency");if(actual instanceof Array)actual=actual[0];
        if(Number(actual)!==engineLatency)throw new Error("Readback "+actual+" differs from "+engineLatency);
        reportedLatency=Number(actual);latencyStatus="reported";
    }catch(e){reportedLatency=null;latencyStatus="error: "+e;post("MD latency: "+e+"\n");}
    redraw();
}
function hosttempo(value) {
    var bpm=clamp(value,20,999,hostTempo);
    if(Math.abs(bpm-hostTempo)<0.001)return;
    hostTempo=bpm;if(engineReady)emit(0,["tempo",hostTempo]);
}
function engine() {
    var args=Array.prototype.slice.call(arguments),name=String(args.shift());
    if(name==="activity") {
        if(engineReady&&args.length===1&&typeof args[0]==="number"&&indexOK(args[0],65536))emit(1,["activity",args[0]]);
    } else if(name==="engineinfo") {
        if(args.length<2||!String(args[0])||!String(args[1]))return;
        engineVersion=String(args[0]);engineArchitecture=String(args[1]);
        if(engineAvailable)return;
        engineAvailable=true;handshakeWaiting=false;
        cancelTask(handshakeTask);handshakeTask=null;scheduleBoot();
    } else if(name==="catalog") {
        try {
            var incoming=JSON.parse(args.join("")),safe=[];
            if(!(incoming instanceof Array))throw new Error("not an array");
            for(var i=0;i<incoming.length;i++) {
                var item=incoming[i],id=Number(item.id);
                if(machineIndex(id)<0)continue;
                var labels=[],defaults=[];
                for(var k=0;k<8;k++){var label=(item.labels||[])[k];labels.push(label===undefined||label===null?("SYN"+(k+1)):String(label));defaults.push(integer((item.defaults||[])[k],0,127,0));}
                safe.push({id:id,name:String(item.name||id),labels:labels,defaults:defaults});
            }
            catalog=safe;
            if(!restoredState) {
                for(var t=0;t<16;t++) {
                    var info=machineInfo(cfg.tracks[t].machine);
                    if(info)for(var p=0;p<8;p++)if(!dirtySynth[t+":"+p])cfg.tracks[t].params[p]=info.defaults[p];
                }
                syncControls();
            }
            redraw();
        } catch(e) {status("Machine catalog could not be read");}
    } else if(name==="latency") {engineLatency=integer(args[0],0,65536,0);haveLatency=true;applyLatency();
    } else if(name==="ready") {
        engineReady=Number(args[0])===1;
        // Native ready 0 means loading has started, not that it has finished.
        if(engineReady){loading=false;failedPath="";syncEngine();status("OS 1.63 ready · MIDI 36–51");}
        else {setReady(false);redraw();}
    } else if(name==="warning") {status(args.join(" "));post("MD Drum Engine: "+args.join(" ")+"\n");}
    else if(name==="error") {if(loading)failedPath=loadedPath;setReady(false);loading=false;status(args.join(" "));}
    else if(name==="status")status(args.join(" "));
}
function control(name,value) {
    if(restoring||(restoredState&&!liveDeviceReady))return;
    name=String(name);var match=/^md_t(\d\d)_(machine|p(\d\d)|lfo(\d\d))$/.exec(name),changed=false;
    if(match) {
        var t=Number(match[1])-1;if(!indexOK(t,16))return;var tr=cfg.tracks[t];
        if(match[2]==="machine") {
            var id=MACHINE_IDS[integer(value,0,MACHINE_IDS.length-1,0)];
            changed=tr.machine!==id;tr.machine=id;
            if(engineReady){emit(0,["machine",t,id]);for(var sk=0;sk<8;sk++)emit(0,["param",t,sk,tr.params[sk]]);}
        } else if(match[3]!==undefined) {
            var p=Number(match[3])-1;if(!indexOK(p,24))return;
            var v=integer(value,0,127,tr.params[p]);changed=tr.params[p]!==v;tr.params[p]=v;
            if(p<8 && initialized && changed)dirtySynth[t+":"+p]=true;
            if(engineReady)emit(0,["param",t,p,v]);
        } else {
            var l=Number(match[4])-1;if(!indexOK(l,5))return;
            var lv=integer(value,0,LFO_MAX[l],tr.lfo[l]);changed=tr.lfo[l]!==lv;tr.lfo[l]=lv;
            if(engineReady)emit(0,["lfo",t,l,lv]);
        }
    } else if((match=/^md_master([0-3])_(\d\d)$/.exec(name))) {
        var g=Number(match[1]),k=Number(match[2])-1;if(!indexOK(k,8))return;
        var mv=integer(value,0,127,cfg.master[g][k]);changed=cfg.master[g][k]!==mv;cfg.master[g][k]=mv;
        if(engineReady)emit(0,["master",g,k,mv]);
    } else if(name==="md_gain") {
        var gain=clamp(value,0,1,cfg.gain);changed=cfg.gain!==gain;cfg.gain=gain;emit(2,[gain]);
    } else return;
    if(changed){mark();redraw();}
}
function action() {
    var args=Array.prototype.slice.call(arguments),name=String(args.shift());
    if(name==="focusparam") {focusParameter(args);return;}
    if(name==="requeststate") {display();return;}
    if(name==="loadfirmware") {emit(3,["loadfirmware"]);return;}
    if(name==="savekit") {emit(3,["kitname","MD-Kit.mdkit"]);emit(3,["savekit"]);return;}
    if(name==="loadkit") {emit(3,["loadkit"]);return;}
    if(name==="openeditor") {emit(3,["openeditor"]);return;}
    if(name==="panic") {emit(0,["panic"]);return;}
    if(name==="selecttrack" && indexOK(args[0],16))cfg.selected=Number(args[0]);
    else if(name==="selectpage" && indexOK(args[0],5))cfg.page=Number(args[0]);
    else if(name==="selectmaster" && indexOK(args[0],4))cfg.masterPage=Number(args[0]);
    else if(name==="random" && indexOK(args[0],16))randomize([Number(args[0])]);
    else if(name==="randomall")randomize([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
    else if(name==="undo")undo();
    else if(name==="resetkit")resetKit();
    else if(name==="audition") {
        if(indexOK(args[0],16) && engineReady)emit(0,["trigger",Number(args[0]),integer(args[1],1,127,100)]);
        else if(!engineReady)status("Load OS 1.63 to play");return;
    } else if(name==="gain")writeControl("md_gain",clamp(args[0],0,1,cfg.gain),false);
    else if(name==="setparam" && indexOK(args[0],16) && indexOK(args[1],24))writeControl(trackName(Number(args[0]),"p",Number(args[1])),integer(args[2],0,127,0),false);
    else if(name==="setlfo" && indexOK(args[0],16) && indexOK(args[1],5))writeControl(trackName(Number(args[0]),"lfo",Number(args[1])),integer(args[2],0,LFO_MAX[Number(args[1])],0),false);
    else if(name==="setmaster" && indexOK(args[0],4) && indexOK(args[1],8))writeControl(masterName(Number(args[0]),Number(args[1])),integer(args[2],0,127,0),false);
    else if(name==="setmachine" && indexOK(args[0],16)) {
        var track=Number(args[0]),id=Number(args[1]),mi=machineIndex(id),info=machineInfo(id);
        if(mi<0 || (catalog.length && !info))return;
        if(cfg.tracks[track].machine===id)return;
        batchDepth++;
        try {
            writeControl(trackName(track,"machine"),mi,false);
            if(info)for(var p=0;p<8;p++)writeControl(trackName(track,"p",p),info.defaults[p],false);
        } finally {batchDepth--;}
    } else return;
    mark();redraw();
}
// Dice: every labelled SYN knob of the track's machine is fully random; the
// track effects move only within ranges that keep the drum audible (filter
// stays open, SRR/AM/DIST are mostly off). Machine, VOL, PAN, sends and LFO
// are never touched. Values go through the real Live parameters, so they are
// saved, automatable and reach the engine exactly like knob moves.
function rnd(lo,hi) { return lo+Math.floor(Math.random()*(hi-lo+1)); }
function sometimes(chance,lo,hi) { return Math.random()<chance?rnd(lo,hi):0; }
var RANDOM_FX = {
    8:function(){return sometimes(0.3,8,56);},   // AMD
    9:function(){return rnd(0,127);},            // AMF
    10:function(){return rnd(0,127);},           // EQF
    11:function(){return rnd(40,88);},           // EQG (64 = flat)
    12:function(){return rnd(0,24);},            // FLTF
    13:function(){return rnd(96,127);},          // FLTW
    14:function(){return rnd(0,48);},            // FLTQ
    15:function(){return sometimes(0.25,4,40);}, // SRR
    16:function(){return sometimes(0.5,8,64);}   // DIST
};
function randomValues(t) {
    var info=machineInfo(cfg.tracks[t].machine),values={};
    for(var k=0;k<8;k++)if(info&&info.labels[k])values[k]=rnd(0,127);
    for(var p in RANDOM_FX)if(RANDOM_FX.hasOwnProperty(p))values[p]=RANDOM_FX[p]();
    return values;
}
// Kit snapshots: the sound of all 16 tracks plus the master effects. Gain,
// the selected view and the OS path are not part of a kit.
function kitSnapshot() {
    var kit={tracks:[],master:[]};
    for(var t=0;t<16;t++){var tr=cfg.tracks[t];kit.tracks.push({machine:tr.machine,params:tr.params.slice(0),lfo:tr.lfo.slice(0)});}
    for(var g=0;g<4;g++)kit.master.push(cfg.master[g].slice(0));
    return kit;
}
// Writes only changed values, machine first so its SYN values land after it.
// Everything goes through the real Live parameters (saved, automatable).
function applyKit(kit) {
    batchDepth++;
    try {
        for(var t=0;t<16;t++) {
            var tr=cfg.tracks[t],next=kit.tracks[t];
            if(next.machine!==tr.machine)writeControl(trackName(t,"machine"),machineIndex(next.machine),false);
            for(var p=0;p<24;p++)if(next.params[p]!==tr.params[p])writeControl(trackName(t,"p",p),next.params[p],false);
            for(var l=0;l<5;l++)if(next.lfo[l]!==tr.lfo[l])writeControl(trackName(t,"lfo",l),next.lfo[l],false);
        }
        for(var g=0;g<4;g++)for(var k=0;k<8;k++)if(kit.master[g][k]!==cfg.master[g][k])writeControl(masterName(g,k),kit.master[g][k],false);
    } finally {batchDepth--;}
}
// One-level Undo for the big moves: dice, Random All, Reset and Load Kit.
function remember() { lastUndo=kitSnapshot(); }
function undo() {
    if(!lastUndo)return;
    var kit=lastUndo;lastUndo=null;applyKit(kit);notice("Undone");
}
function randomize(tracks) {
    if(!engineReady||!catalog.length){status("Load OS 1.63 to randomize");return;}
    remember();
    batchDepth++;
    try {
        for(var i=0;i<tracks.length;i++) {
            var t=tracks[i],values=randomValues(t);
            for(var k in values)if(values.hasOwnProperty(k))writeControl(trackName(t,"p",Number(k)),values[k],false);
        }
    } finally {batchDepth--;}
    notice(tracks.length===16?"All tracks randomized · Undo restores":"T"+two(tracks[0]+1)+" randomized · Undo restores");
}
// The device's own starting kit: default machines with the OS's factory
// SYN values, neutral track effects, default LFOs and master effects.
function defaultKit() {
    var fresh=freshState(),kit={tracks:fresh.tracks,master:fresh.master};
    for(var t=0;t<16;t++){var info=machineInfo(kit.tracks[t].machine);if(info)for(var p=0;p<8;p++)kit.tracks[t].params[p]=info.defaults[p];}
    return kit;
}
function resetKit() { remember();applyKit(defaultKit());notice("Default kit restored · Undo restores"); }
// Kit files (.mdkit): readable JSON the user saves/loads anywhere through the
// standard dialogs. Machines are stored by id and name; values are raw 0-127
// like a Machinedrum kit. Non-ASCII is escaped so Max's File I/O stays 8-bit safe.
var KIT_FORMAT="MD Drum Engine kit", MACHINE_NAMES={1:"GND-SN",2:"GND-NS",3:"GND-IM",16:"TRX-BD",17:"TRX-SD",18:"TRX-XT",19:"TRX-CP",20:"TRX-RS",21:"TRX-CB",22:"TRX-CH",23:"TRX-OH",24:"TRX-CY",25:"TRX-MA",26:"TRX-CL",27:"TRX-XC",28:"TRX-B2",32:"EFM-BD",33:"EFM-SD",34:"EFM-XT",35:"EFM-CP",36:"EFM-RS",37:"EFM-CB",38:"EFM-HH",39:"EFM-CY",48:"E12-BD",49:"E12-SD",50:"E12-HT",51:"E12-LT",52:"E12-CP",53:"E12-RS",54:"E12-CB",55:"E12-CH",56:"E12-OH",57:"E12-RC",58:"E12-CC",59:"E12-BR",60:"E12-TA",61:"E12-TR",62:"E12-SH",63:"E12-BC",64:"P-I-BD",65:"P-I-SD",66:"P-I-MT",67:"P-I-ML",68:"P-I-MA",69:"P-I-RS",70:"P-I-RC",71:"P-I-CC",72:"P-I-HH"};
var MASTER_KEYS=["reverb","echo","eq","dynamics"];
function kitName(path) { var base=String(path).replace(/^.*[\/:]/,"");return base.replace(/\.mdkit$/i,"")||"Kit"; }
function kitText(name) {
    var kit=kitSnapshot(),out={format:KIT_FORMAT,version:1,name:name,tracks:[],master:{}};
    for(var t=0;t<16;t++){var tr=kit.tracks[t];out.tracks.push({track:t+1,machine:MACHINE_NAMES[tr.machine]||String(tr.machine),id:tr.machine,params:tr.params,lfo:tr.lfo});}
    for(var g=0;g<4;g++)out.master[MASTER_KEYS[g]]=kit.master[g];
    // One line per track and per master effect keeps the file easy to read and diff.
    var lines=['{','  "format": '+JSON.stringify(KIT_FORMAT)+',','  "version": 1,','  "name": '+JSON.stringify(name)+',','  "tracks": ['];
    for(t=0;t<16;t++)lines.push('    '+JSON.stringify(out.tracks[t])+(t<15?',':''));
    lines.push('  ],','  "master": {');
    for(g=0;g<4;g++)lines.push('    '+JSON.stringify(MASTER_KEYS[g])+': '+JSON.stringify(out.master[MASTER_KEYS[g]])+(g<3?',':''));
    lines.push('  }','}');
    return (lines.join("\n")+"\n").replace(/[\u0080-\uffff]/g,function(c){return "\\u"+("000"+c.charCodeAt(0).toString(16)).slice(-4);});
}
function machineFromKit(tr) {
    var id=Number(tr.id);if(machineIndex(id)>=0)return id;
    for(var k in MACHINE_NAMES)if(MACHINE_NAMES.hasOwnProperty(k)&&MACHINE_NAMES[k]===String(tr.machine))return Number(k);
    return -1;
}
// Returns a complete kit or throws with a reason the LCD can show.
function parseKit(text) {
    var data=JSON.parse(text);
    if(!data||data.format!==KIT_FORMAT)throw new Error("Not an MD Drum Engine kit");
    if(!(data.tracks instanceof Array)||data.tracks.length!==16)throw new Error("Kit must have 16 tracks");
    var kit=kitSnapshot();
    for(var t=0;t<16;t++) {
        var tr=data.tracks[t]||{},id=machineFromKit(tr);
        if(id<0)throw new Error("Unknown machine on track "+(t+1));
        kit.tracks[t].machine=id;
        for(var p=0;p<24;p++)kit.tracks[t].params[p]=integer((tr.params||[])[p],0,127,kit.tracks[t].params[p]);
        for(var l=0;l<5;l++)kit.tracks[t].lfo[l]=integer((tr.lfo||[])[l],0,LFO_MAX[l],kit.tracks[t].lfo[l]);
    }
    for(var g=0;g<4;g++)for(var k=0;k<8;k++)kit.master[g][k]=integer(((data.master||{})[MASTER_KEYS[g]]||[])[k],0,127,kit.master[g][k]);
    return kit;
}
function joinPath(args) { return Array.prototype.slice.call(args).join(" "); }
function savekitpath() {
    var path=joinPath(arguments);if(!path)return;
    try {
        var text=kitText(kitName(path)),f=new File(path,"write","TEXT");
        if(!f.isopen)throw new Error("cannot open file");
        f.position=0;for(var i=0;i<text.length;i+=4000)f.writestring(text.substring(i,i+4000));
        f.eof=f.position;f.close();
        notice("Kit saved: "+kitName(path));
    } catch(e) {status("Kit not saved: "+e.message);post("MD Drum Engine: kit save failed: "+e+" ("+path+")\n");}
}
function loadkitpath() {
    var path=joinPath(arguments);if(!path)return;
    try {
        var f=new File(path,"read"),text="";
        if(!f.isopen)throw new Error("cannot open file");
        while(f.position<f.eof){var chunk=f.readstring(4000);if(!chunk)break;text+=chunk;}
        f.close();
        var kit=parseKit(text);remember();applyKit(kit);notice("Kit loaded: "+kitName(path));
    } catch(e) {status("Kit not loaded: "+e.message);post("MD Drum Engine: kit load failed: "+e+" ("+path+")\n");}
    mark();redraw();
}
// A short confirmation on the LCD, then back to the normal ready line.
function notice(text) {
    status(text);cancelTask(noticeTask);
    noticeTask=schedule(function(){noticeTask=null;if(engineReady&&engineStatus===text)status("OS 1.63 ready · MIDI 36–51");},2500);
}
function persistentState() {return cfg;}
function getvalueof() {
    var encoded=JSON.stringify(persistentState()),parts=["MDENGINESTATE1"];
    for(var i=0;i<encoded.length;i+=6000)parts.push(encoded.substring(i,i+6000));return parts;
}
function setvalueof() {
    var parts=Array.prototype.slice.call(arguments);
    if(parts.length===1 && parts[0] instanceof Array)parts=parts[0].slice(0);
    if(parts[0]==="MDENGINESTATE1")parts.shift();
    var saved;
    try{saved=JSON.parse(parts.join(""));}catch(e){return;}
    if(!saved || saved.version!==1 || !(saved.tracks instanceof Array) || saved.tracks.length!==16)return;
    var next=freshState();
    next.firmware=typeof saved.firmware==="string"?saved.firmware:"";
    next.selected=integer(saved.selected,0,15,0);next.page=integer(saved.page,0,4,0);next.masterPage=integer(saved.masterPage,0,3,0);
    next.gain=clamp(saved.gain,0,1,0.7);
    for(var t=0;t<16;t++) {
        var tr=saved.tracks[t]||{},nt=next.tracks[t];
        if(machineIndex(Number(tr.machine))>=0)nt.machine=Number(tr.machine);
        for(var p=0;p<24;p++)nt.params[p]=integer((tr.params||[])[p],0,127,nt.params[p]);
        for(var l=0;l<5;l++)nt.lfo[l]=integer((tr.lfo||[])[l],0,LFO_MAX[l],nt.lfo[l]);
    }
    for(var g=0;g<4;g++)for(var k=0;k<8;k++)next.master[g][k]=integer(((saved.master||[])[g]||[])[k],0,127,next.master[g][k]);
    // Recall into an already-playing instance must not leave a 100 ms window
    // where the panel shows the recalled kit but new MIDI notes use the old one.
    if(initialized){
        emit(3,["ready",0]);
        // Closing MIDI alone cannot stop sustained voices or effect tails.
        // Same-ROM recall keeps them; changing/clearing the ROM silences now.
        if(engineReady&&(!next.firmware||loadedPath!==next.firmware))emit(0,["panic"]);
    }
    cfg=next;restoredState=true;dirtySynth={};lastUndo=null;
    if(initialized){
        syncControls();
        if(engineReady&&cfg.firmware&&loadedPath===cfg.firmware){cancelTask(bootTask);bootTask=null;syncEngine();}
        else {setReady(false);scheduleBoot();}
    }
    redraw();
}
function notifydeleted() {cancelTask(noticeTask);noticeTask=null;cancelTask(redrawTask);cancelTask(bootTask);cancelTask(handshakeTask);redrawTask=null;bootTask=null;handshakeTask=null;handshakeWaiting=false;}
