/* QA ONLY. Real Max object API / parameter / MIDI / stereo recording verification.
 * The production device never loads this script or these timed note actions.
 * args: firmware, report JSON, output WAV, mode(max/live).
 * outlets: MIDI[pitch,velocity], sfrecord~ commands, silent dac~ commands, DSP queries.
 */
autowatch=0;
inlets=1;
outlets=4;
// Capture the JSThis patcher once: Task callbacks do not preserve their caller's this.
var hostPatcher=this.patcher, hostContext=this;
var firmware=String(jsarguments[1]||''),reportPath=String(jsarguments[2]||''),wavePath=String(jsarguments[3]||''),mode=String(jsarguments[4]||'max');
var expectedNativeVersion=String(jsarguments[5]||''),selectedFirmwarePath='';
var began=false,finished=false,recording=false,readySeen=false,controlTestsStarted=false,initialDsp=null,currentDsp=0,queryInitial=false,startedDsp=false;
var tasks=[],timeoutTask=null,baseline=null,saved=null,savedDecoded=null,lastPanel=null,machines=[],mappedNotes=[],expectedNotes=[],recordStart=0;
var phaseSelected=false,isReopen=false,reopenExpected=null,hostReady=false,liveParameterIndices={};
var report={version:1,mode:mode,status:'waiting',firmware:firmware,reportPath:reportPath,wavePath:wavePath,startedAt:'',completedAt:'',sampleRate:0,initialDsp:null,events:[],checks:[],snapshots:{},audio:{durationRequestedMs:5500,maxAbs:[0,0],samplesObserved:[0,0]}};
function now(){return(new Date()).getTime();}
function stamp(){var date=new Date();return date.toISOString?date.toISOString():String(date);}
function log(name,data){report.events.push({time:stamp(),name:name,data:data===undefined?null:data});if(report.events.length>250)report.events.shift();}
function writeJson(file,value) {
    var encoded=JSON.stringify(value,null,2)+"\n";file.eof=0;
    // Legacy Max File.writestring truncates a single string around32KiB.
    for(var offset=0;offset<encoded.length;){
        var end=Math.min(offset+8192,encoded.length);
        if(end<encoded.length&&encoded.charCodeAt(end-1)>=55296&&encoded.charCodeAt(end-1)<=56319)end--;
        file.writestring(encoded.substring(offset,end));offset=end;
    }
}
function writeReport(){
    if(!reportPath||!phaseSelected)return;
    var file=new File(reportPath,'write','TEXT');
    if(!file.isopen){post('MD QA: cannot write '+reportPath+'\n');return;}
    writeJson(file,report);file.close();
}
function check(name,condition,details){report.checks.push({name:name,pass:!!condition,details:details===undefined?null:details});if(!condition)post('MD QA FAILED: '+name+' '+JSON.stringify(details)+'\n');}
function schedule(fn,delay){var t=new Task(function(){if(t.dead||finished)return;try{fn();}catch(e){fatal(String(e));}finally{t.dead=true;if(t.freepeer)t.freepeer();}},hostContext);tasks.push(t);t.schedule(delay);return t;}
function object(name){var obj=hostPatcher.getnamed(name);if(!obj)throw new Error('Object not found: '+name);return obj;}
function bridge(){return object('md_state');}
function command(){var args=arrayfromargs(arguments);bridge().message.apply(bridge(),args);}
function action(){var args=arrayfromargs(arguments);args.unshift('action');command.apply(this,args);}
function scalar(name){var value=object(name).getvalueof();if(value instanceof Array)value=value[0];return Number(value);}
function readState(){
    var raw=bridge().getvalueof(),parts=raw instanceof Array?raw.slice(0):[String(raw)];
    if(parts[0]==='MDENGINESTATE1')parts.shift();
    return {raw:raw,decoded:JSON.parse(parts.join(''))};
}
function restoreState(raw){var target=bridge();if(raw instanceof Array)target.setvalueof.apply(target,raw);else target.setvalueof(raw);}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function two(value){return value<10?'0'+value:String(value);}
function nativeSnapshot(){
    var snap={tracks:[],master:[],gain:scalar('md_gain')};
    for(var t=0;t<16;t++){
        var prefix='md_t'+two(t+1)+'_',tr={machineIndex:scalar(prefix+'machine'),params:[],lfo:[]};
        for(var k=0;k<24;k++)tr.params.push(scalar(prefix+'p'+two(k+1)));
        for(var l=0;l<5;l++)tr.lfo.push(scalar(prefix+'lfo'+two(l+1)));
        snap.tracks.push(tr);
    }
    for(var g=0;g<4;g++){var group=[];for(var p=0;p<8;p++)group.push(scalar('md_master'+g+'_'+two(p+1)));snap.master.push(group);}
    return snap;
}
function verifyNative(savedState){
    var snap=nativeSnapshot(),ids=[];for(var i=0;i<machines.length;i++)ids.push(Number(machines[i].id));ids.sort(function(a,b){return a-b;});
    var mismatches=[];
    for(var t=0;t<16;t++){
        if(ids[snap.tracks[t].machineIndex]!==savedState.tracks[t].machine)mismatches.push('T'+two(t+1)+' machine');
        if(!eq(snap.tracks[t].params,savedState.tracks[t].params))mismatches.push('T'+two(t+1)+' params');
        if(!eq(snap.tracks[t].lfo,savedState.tracks[t].lfo))mismatches.push('T'+two(t+1)+' LFO');
    }
    if(!eq(snap.master,savedState.master))mismatches.push('master');
    if(Math.abs(snap.gain-savedState.gain)>0.00001)mismatches.push('gain');
    check('All513 native parameters match restored state',mismatches.length===0,mismatches);return snap;
}
function start(){
    if(began)return;began=true;
    schedule(function(){
        isReopen=!!reopenExpected;phaseSelected=true;report.startedAt=stamp();
        if(isReopen){
            reportPath=reportPath.replace(/\.json$/,'.reopen.json');report.reportPath=reportPath;report.status='waiting for restored firmware';writeReport();
            if(readySeen&&!controlTestsStarted){controlTestsStarted=true;schedule(beginControlTests,350);}
            timeoutTask=schedule(function(){fatal('Timed out waiting for firmware restored by host state');},90000);return;
        }
        report.status='starting';writeReport();
        log('Max objects found',{bridgeClass:object('md_state').maxclass});
        command('init');queryInitial=true;outlet(3,'bang');
        schedule(function(){
            queryInitial=false;report.initialDsp=initialDsp;
            // dac~ is present solely to run the graph, with no physical signal connections.
            if(mode==='max'&&initialDsp!==1){startedDsp=true;outlet(2,'start');}
            outlet(3,'bang');report.status='loading firmware';log('loadFirmware',firmware);writeReport();object('qa_native_path').message(firmware);
            timeoutTask=schedule(function(){fatal('Timed out waiting for native ready1');},90000);
        },80);
    },400);
}
function loadbang(){start();}
function engine(){
    var args=arrayfromargs(arguments),name=String(args.shift());
    if(name==='engineinfo'){report.nativeVersion=String(args[0]);report.nativeArchitecture=String(args[1]);writeReport();}
    else if(name==='catalog'){try{machines=JSON.parse(args.join(''));report.catalogCount=machines.length;report.catalogIds=[];for(var i=0;i<machines.length;i++)report.catalogIds.push(machines[i].id);log('catalog',machines.length);}catch(e){fatal('Catalog JSON: '+e);}writeReport();}
    else if(name==='latency'){report.latencySamples=Number(args[0]);log('nativeLatency',report.latencySamples);writeReport();}
    else if(name==='status'){log('engineStatus',args.join(' '));writeReport();}
    else if(name==='error'){log('engineError',args.join(' '));fatal('Native engine error: '+args.join(' '));}
    else if(name==='ready'){
        report.ready=Number(args[0])===1;log('ready',report.ready);writeReport();
        if(report.ready)readySeen=true;
        if(report.ready&&phaseSelected&&!controlTestsStarted){controlTestsStarted=true;if(timeoutTask){timeoutTask.dead=true;timeoutTask.cancel();}schedule(beginControlTests,350);}
    }
}
function panel(){var args=arrayfromargs(arguments);if(String(args.shift())!=='state')return;try{lastPanel=JSON.parse(args.join(''));}catch(e){log('panelParseError',String(e));}}
function selectedpath(){selectedFirmwarePath=arrayfromargs(arguments).join(' ');report.selectedFirmwarePath=selectedFirmwarePath;}
function driver_sample_rate(value){report.driverSampleRate=Number(value);if(Number(value)>0)report.sampleRate=Number(value);}
function samplerate(value){report.dspSampleRate=Number(value);if(Number(value)>0)report.sampleRate=Number(value);}
function dspstate(value){currentDsp=Number(value);report.currentDsp=currentDsp;if(queryInitial&&initialDsp===null)initialDsp=currentDsp;}
function vectorsize(value){report.signalVectorSize=Number(value);}
function level(channel,value){channel=Number(channel);if(!recording||channel<0||channel>1)return;report.audio.samplesObserved[channel]++;report.audio.maxAbs[channel]=Math.max(report.audio.maxAbs[channel],Math.abs(Number(value)||0));}
function mapped(){var args=arrayfromargs(arguments);if(args.shift()!=='trigger')return;var entry={track:Number(args[0]),velocity:Number(args[1]),ms:recording?now()-recordStart:null};mappedNotes.push(entry);log('nativeMidiMapped',entry);}
function auditSends(){
    var original=readState();
    for(var t=0;t<16;t++){action('setparam',t,19,20+t);action('setparam',t,20,70+t);}
    schedule(function(){
        var current=readState().decoded,mismatches=[];
        for(var t=0;t<16;t++){
            if(scalar('md_t'+two(t+1)+'_p20')!==20+t||current.tracks[t].params[19]!==20+t)mismatches.push('T'+two(t+1)+' DEL');
            if(scalar('md_t'+two(t+1)+'_p21')!==70+t||current.tracks[t].params[20]!==70+t)mismatches.push('T'+two(t+1)+' REV');
        }
        check('All32 sends reach their own actual Max parameter and saved track',mismatches.length===0,mismatches);
        check('Send edits preserve master FX',eq(current.master,original.decoded.master));
        restoreState(original.raw);schedule(runControlChecks,150);
    },150);
}
function runControlChecks(){
    report.status='checking controls';check('Native firmware ready',readySeen,true);if(expectedNativeVersion)check('Expected native version loaded',report.nativeVersion===expectedNativeVersion,{expected:expectedNativeVersion,actual:report.nativeVersion,architecture:report.nativeArchitecture});check('Firmware machine catalog has49 entries',machines.length===49,machines.length);
    var first=readState();baseline=first.raw;report.snapshots.initial=first.decoded;
    check('Bridge getvalueof returns version1 state',first.decoded.version===1&&first.decoded.tracks.length===16);
    check('Firmware external path persisted',!!selectedFirmwarePath&&first.decoded.firmware===selectedFirmwarePath,first.decoded.firmware);
    check('Panel receives readiness',lastPanel&&lastPanel.ready===true,lastPanel?lastPanel.status:'no state received');
    report.snapshots.track2Before=first.decoded.tracks[1];
    action('selecttrack',7);action('setparam',0,0,91);
    schedule(function(){
        var state=readState().decoded;
        check('UI action updates native T01 P01',scalar('md_t01_p01')===91,scalar('md_t01_p01'));
        check('UI action updates saved T01 value',state.tracks[0].params[0]===91,state.tracks[0].params[0]);
        if(mode==='live')check('UI writes reach actual Live host parameter',readLiveValue('T01 P01')===91,readLiveValue('T01 P01'));
        check('T02 remains isolated from selected-track edits',eq(state.tracks[1],report.snapshots.track2Before));
        check('Selection has no effect on automation address',state.selected===7&&state.tracks[7].params[0]===report.snapshots.initial.tracks[7].params[0]);
        if(mode==='live'){
            var api=new LiveAPI(function(){},'this_device parameters '+liveParameterIndices['T01 P01']);api.set('value',93);api.id=0;
            schedule(function(){
                check('Live host parameter writes reach bridge and native controls',readState().decoded.tracks[0].params[0]===93&&scalar('md_t01_p01')===93);
                check('Host automation writes preserve T02',eq(readState().decoded.tracks[1],report.snapshots.track2Before));
                action('setmachine',0,32);schedule(checkMachine,130);
            },130);
        }else{action('setmachine',0,32);schedule(checkMachine,130);}
    },130);
}
function checkMachine(){
    var state=readState().decoded,info=null;for(var i=0;i<machines.length;i++)if(Number(machines[i].id)===32)info=machines[i];
    check('Machine action chooses EFM-BD',state.tracks[0].machine===32,state.tracks[0].machine);
    check('Machine change loads actual firmware defaults',info&&eq(state.tracks[0].params.slice(0,8),info.defaults),state.tracks[0].params.slice(0,8));
    action('setlfo',0,4,2);action('setlfo',0,2,99);action('setparam',0,21,79);action('setparam',0,22,22);
    action('setmaster',1,3,58);action('setparam',0,19,40);action('gain',0.61);action('selectpage',3);action('selectmaster',1);
    schedule(function(){
        var state=readState().decoded;
        check('LFO type updated through native control',scalar('md_t01_lfo05')===2&&state.tracks[0].lfo[4]===2);
        check('LFO shape clamped to hardware range',scalar('md_t01_lfo03')===5&&state.tracks[0].lfo[2]===5);
        check('LFO amount parameters update',scalar('md_t01_p22')===79&&scalar('md_t01_p23')===22);
        check('Master delay feedback updates native and state',scalar('md_master1_04')===58&&state.master[1][3]===58);
        var capture=readState();savedDecoded=capture.decoded;saved=diskRoundtrip(capture.raw,savedDecoded);report.snapshots.beforeRecall=savedDecoded;
        action('setparam',0,0,3);action('setparam',1,0,4);action('setlfo',0,4,0);action('setmaster',1,3,1);action('gain',0.2);action('selecttrack',2);
        schedule(function(){
            check('State was changed before recall',readState().decoded.tracks[0].params[0]===3&&Math.abs(scalar('md_gain')-0.2)<0.00001);
            restoreState(saved);
            schedule(checkRecall,350);
        },130);
    },130);
}
function checkRecall(){
    var actual=readState().decoded;report.snapshots.afterRecall=actual;
    check('Maxobj.setvalueof restores complete bridge JSON',eq(actual,savedDecoded));
    report.snapshots.nativeAfterRecall=verifyNative(savedDecoded);
    // Return to the stock kit before testing the real native MIDI/audio path.
    restoreState(baseline);schedule(prepareRecord,350);writeReport();
}
function prepareRecord(){
    report.status='recording MIDI/audio';outlet(3,'bang');mappedNotes=[];expectedNotes=[];
    outlet(1,['samptype','float32']);outlet(1,['open',wavePath]);
    schedule(function(){
        recording=true;recordStart=now();outlet(1,1);log('recordStart',wavePath);
        var score=[[80,35,100],[130,127,100],[180,16,100],[230,36,0],[350,36,105],[850,38,110],[1350,42,80],[1900,0,100],[2450,51,90],[3050,39,106],[3650,46,100],[4200,36,80]];
        for(var i=0;i<score.length;i++)(function(event){schedule(function(){
            var pitch=event[1],velocity=event[2],track=(pitch>=36&&pitch<=51)?pitch-36:(pitch>=0&&pitch<=15)?pitch:-1;
            if(track>=0&&velocity>0)expectedNotes.push([track,velocity]);
            log('midiInput',{pitch:pitch,velocity:velocity,ms:now()-recordStart});outlet(0,[pitch,velocity]);
        },event[0]);})(score[i]);
        schedule(function(){recording=false;outlet(1,0);report.audio.elapsedWallMs=now()-recordStart;log('recordStop',report.audio.elapsedWallMs);schedule(complete,600);},5500);
        writeReport();
    },150);
}
function complete(){
    var actual=[];for(var i=0;i<mappedNotes.length;i++)actual.push([mappedNotes[i].track,mappedNotes[i].velocity]);
    report.midi={expected:expectedNotes,actual:mappedNotes};
    check('Real native MIDI mapping includes aliases and rejects invalid/note-off',eq(actual,expectedNotes),{expected:expectedNotes,actual:actual});
    check('Actual DSP sample rate available',report.sampleRate>0,report.sampleRate);
    var latencyValue=hostPatcher.getattr('latency');report.patcherLatency=Number(latencyValue instanceof Array?latencyValue[0]:latencyValue);
    if(mode==='live')check('Live patcher latency matches native core delay',report.latencySamples>=0&&report.patcherLatency===report.latencySamples,{core:report.latencySamples,patcher:report.patcherLatency});
    check('Left audio signal is nonzero',report.audio.maxAbs[0]>0.0000001,report.audio.maxAbs[0]);
    check('Right audio signal is nonzero',report.audio.maxAbs[1]>0.0000001,report.audio.maxAbs[1]);
    var file=new File(wavePath,'read');report.audio.fileOpened=file.isopen;if(file.isopen){report.audio.fileBytes=file.eof;file.close();}
    check('Stereo recording file exists with audio payload',report.audio.fileOpened&&report.audio.fileBytes>1024,report.audio.fileBytes);
    restoreState(saved);schedule(finishQA,350);
}
function fatal(message){
    if(finished)return;recording=false;outlet(1,0);if(startedDsp)outlet(2,'stop');
    report.status='failed';report.fatal=String(message);report.completedAt=stamp();log('fatal',String(message));finished=true;writeReport();post('MD QA FATAL: '+message+' — '+reportPath+'\n');
}
function notifydeleted(){for(var i=0;i<tasks.length;i++)if(!tasks[i].dead){tasks[i].dead=true;tasks[i].cancel();if(tasks[i].freepeer)tasks[i].freepeer();}if(recording)outlet(1,0);if(startedDsp&&!finished)outlet(2,'stop');}

function expectedSoundNames(){
    var names=[],lfo=['Destination Track','Destination Param','Shape 1','Shape 2','Mode'];
    var groups=['Reverb','Delay','EQ','Dynamix'],labels=[['DVOL','PRED','DEC','DAMP','HP','LP','GATE','LEV'],['TIME','MOD','MFRQ','FB','FLTF','FLTW','MONO','LEV'],['LF','LG','HF','HG','PF','PG','PQ','GAIN'],['ATCK','REL','TRHD','RTIO','KNEE','HP','OUTG','MIX']];
    for(var t=0;t<16;t++){var prefix='T'+two(t+1);names.push(prefix+' Machine');for(var p=0;p<24;p++)names.push(prefix+' P'+two(p+1));for(var k=0;k<5;k++)names.push(prefix+' LFO '+lfo[k]);}
    for(var g=0;g<4;g++)for(var j=0;j<8;j++)names.push(groups[g]+' '+labels[g][j]);names.push('Master Gain');return names;
}
function apiValue(value){return value instanceof Array?value[0]:value;}
function readLiveValue(name){
    var index=liveParameterIndices[name];if(index===undefined)throw new Error('Live parameter missing: '+name);
    var api=new LiveAPI(function(){},'this_device parameters '+index),value=Number(apiValue(api.get('value')));api.id=0;return value;
}
function enumerateLive(done){
    if(!hostReady){schedule(function(){enumerateLive(done);},100);return;}
    var device=new LiveAPI(function(){},'this_device'),count=Number(device.getcount('parameters'));
    check('LiveAPI resolves this_device',Number(device.id)>0,device.id);
    report.liveParameters={deviceId:Number(device.id),total:count,entries:[],missing:[],duplicates:[],soundCount:0};
    var target=new LiveAPI(function(){},'this_device'),index=0,seen={};liveParameterIndices={};
    function batch(){
        var stop=Math.min(index+24,count);
        for(;index<stop;index++){
            target.path='this_device parameters '+index;
            var name=String(apiValue(target.get('name'))),entry={index:index,id:Number(target.id),name:name,value:apiValue(target.get('value'))};
            report.liveParameters.entries.push(entry);if(seen[name])report.liveParameters.duplicates.push(name);seen[name]=true;liveParameterIndices[name]=index;
        }
        if(index<count){schedule(batch,15);return;}
        var expected=expectedSoundNames();for(var i=0;i<expected.length;i++){if(!seen[expected[i]])report.liveParameters.missing.push(expected[i]);else report.liveParameters.soundCount++;}
        check('Live exposes all513 stable sound parameters',report.liveParameters.soundCount===513&&report.liveParameters.missing.length===0,{total:count,soundCount:report.liveParameters.soundCount,missing:report.liveParameters.missing});
        check('Live sound parameter names are unique',report.liveParameters.duplicates.length===0,report.liveParameters.duplicates);
        device.id=0;target.id=0;writeReport();done();
    }
    batch();
}
function hostready(){hostReady=true;log('liveThisDeviceReady',true);}
function beginControlTests(){
    if(isReopen){if(mode==='live')enumerateLive(verifyHostReload);else verifyHostReload();return;}
    if(mode==='live')enumerateLive(auditSends);else auditSends();
}
function diskRoundtrip(raw,decoded){
    var path=reportPath.replace(/\.json$/,'.state.json'),f=new File(path,'write','TEXT');
    if(!f.isopen)throw new Error('Cannot save QA state fixture');
    writeJson(f,{version:1,parts:raw,state:decoded});f.close();
    // .json is classified as JSON by Max; a TEXT read filter rejects that existing file.
    f=new File(path,'read');if(!f.isopen)throw new Error('Cannot reopen QA state fixture: '+path);
    var text=f.readstring(f.eof);f.close();var loaded=JSON.parse(text);
    check('State JSON survives actual disk save/reload',eq(loaded.state,decoded));report.stateFixture=path;return loaded.parts;
}
function getvalueof(){return['MDQASTATE1',JSON.stringify({version:1,expected:reopenExpected})];}
function setvalueof(){
    var parts=arrayfromargs(arguments);if(parts.length===1&&parts[0] instanceof Array)parts=parts[0];if(parts[0]==='MDQASTATE1')parts=parts.slice(1);
    try{var value=JSON.parse(parts.join(''));if(value.version===1&&value.expected&&value.expected.tracks&&value.expected.tracks.length===16)reopenExpected=value.expected;}catch(e){}
}
function verifyHostReload(){
    var current=readState().decoded;report.snapshots.expectedAfterHostReload=reopenExpected;report.snapshots.actualAfterHostReload=current;
    check('Host save/reopen restores entire bridge state',eq(current,reopenExpected));
    report.snapshots.nativeAfterHostReload=verifyNative(reopenExpected);
    check('Host reload retains external firmware path',current.firmware===reopenExpected.firmware,current.firmware);
    var failed=0;for(var i=0;i<report.checks.length;i++)if(!report.checks[i].pass)failed++;
    report.failedChecks=failed;report.status=failed?'failed':'passed';report.completedAt=stamp();report.testKind='actual host save/reopen';
    finished=true;writeReport();post('MD QA HOST REOPEN: '+report.status+' — '+reportPath+'\n');
}
function finishQA(){
    action('selecttrack',0);action('selectpage',0);action('openeditor');action('requeststate');
    schedule(function(){
        reopenExpected=readState().decoded;report.hostReloadExpected=reopenExpected;
        // Saved only in this QA variant. On actual host reopen, test the restored
        // state before making any edits, rather than silently applying a fixture.
        if(typeof notifyclients==='function')notifyclients();
        var failed=0;for(var c=0;c<report.checks.length;c++)if(!report.checks[c].pass)failed++;
        report.failedChecks=failed;report.status=failed?'failed':'passed';report.completedAt=stamp();
        report.hostReopenNextStep='Save this completed QA device or Live Set, close and reopen it. The persisted QA token triggers verification only and writes a .reopen.json report.';
        if(startedDsp)outlet(2,'stop');finished=true;writeReport();post('MD QA COMPLETE: '+report.status+' — '+reportPath+'\n');
    },120);
}
