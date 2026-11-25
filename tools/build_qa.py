#!/usr/bin/env python3
"""Generate QA-only production-patch variants. Opening a variant runs a silent-to-speakers test.

Artifacts are deliberately separate from the distributable device. The harness writes
JSON and stereo WAV files, never changes the global sample rate, and restores DSP when
it started it. Max and Live outputs use separate names to preserve both pieces of evidence.
"""
import argparse
import copy
import json
import struct
from pathlib import Path
from build_device import build, ROOT, DEV

def build_qa(firmware,mode='max'):
    doc=copy.deepcopy(build());p=doc['patcher'];boxes={e['box']['id']:e['box'] for e in p['boxes']}
    for ident in ['engine','note_pack','note_range','gain_left','gain_right','native_path']:
        boxes[ident]['varname']='qa_'+ident
    p['lines']=[e for e in p['lines'] if e['patchline']['destination'][0]!='plugout']
    for e in p['lines']:
        if e['patchline']['source']==['engine',2]:e['patchline']['order']=0
    def box(ident,text='',ni=1,no=1,**kw):
        b={'id':ident,'maxclass':'newobj','numinlets':ni,'numoutlets':no,'patching_rect':[24,5200+len(p['boxes'])*24,240,22]}
        if text:b['text']=text
        if no:b['outlettype']=['']*no
        b.update(kw);p['boxes'].append({'box':b});boxes[ident]=b
    def wire(source,dest,so=0,di=0,order=None):
        line={'source':[source,so],'destination':[dest,di]}
        if order is not None:line['order']=order
        p['lines'].append({'patchline':line})
    report=ROOT/'artifacts'/f'{mode}-integration.json';wave=ROOT/'artifacts'/f'{mode}-integration.wav'
    # Max object text quotes preserve spaces in the user's original firmware path.
    args=' '.join('"'+str(a).replace('"','\\"')+'"' for a in [firmware,report,wave,mode])
    box('qa','js md.qa.js '+args,no=4,varname='md_qa')
    box('qa_hostready','hostready',maxclass='message');wire('device','qa_hostready');wire('qa_hostready','qa')
    box('qa_saved_state','pattr md_qa_saved @bindto md_qa @parameter_enable 1',no=3,varname='md_qa_saved',
        saved_object_attributes={'parameter_enable':1,'parameter_mappable':0},
        saved_attribute_attributes={'valueof':{'parameter_longname':'MD QA saved state','parameter_shortname':'QA state',
        'parameter_type':3,'parameter_invisible':1,'parameter_initial_enable':0}},restore=[''])
    p['parameters']['qa_saved_state']=['MD QA saved state','QA state',0]

    box('qa_boot','start',maxclass='message');wire('load','qa_boot');wire('qa_boot','qa')
    box('qa_engine_pre','prepend engine');wire('engine','qa_engine_pre',2,order=1);wire('qa_engine_pre','qa')
    box('qa_panel_pre','prepend panel');wire('bridge','qa_panel_pre',1);wire('qa_panel_pre','qa')
    box('qa_path_pre','prepend selectedpath');wire('native_path','qa_path_pre');wire('qa_path_pre','qa')
    box('qa_midi_unpack','unpack i i',no=2);wire('qa','qa_midi_unpack')
    wire('qa_midi_unpack','note_pack',1,1);wire('qa_midi_unpack','note_range')
    box('qa_mapped_pre','prepend mapped');wire('engine_ready_gate','qa_mapped_pre');wire('qa_mapped_pre','qa')
    box('qa_recorder','sfrecord~ 2',ni=2,no=1,varname='qa_recorder');wire('gain_left','qa_recorder');wire('gain_right','qa_recorder',0,1);wire('qa','qa_recorder',1)
    box('qa_silent_dac','dac~',ni=2,no=0);wire('qa','qa_silent_dac',2)
    box('qa_dspstate','dspstate~',no=4);wire('qa','qa_dspstate',3)
    for outlet,name in [(0,'dspstate'),(1,'samplerate'),(2,'vectorsize')]:
        ident='qa_'+name+'_pre';box(ident,'prepend '+name);wire('qa_dspstate',ident,outlet);wire(ident,'qa')
    box('qa_driver_sr','adstatus sr',ni=2,no=2);box('qa_driver_sr_pre','prepend driver_sample_rate')
    wire('qa','qa_driver_sr',3);wire('qa_driver_sr','qa_driver_sr_pre',1);wire('qa_driver_sr_pre','qa')
    for channel,gain in [(0,'gain_left'),(1,'gain_right')]:
        ident='qa_level'+str(channel);box(ident,'snapshot~ 10');box(ident+'_pre','prepend level '+str(channel));wire(gain,ident);wire(ident,ident+'_pre');wire(ident+'_pre','qa')
    p['dependency_cache'].append({'name':'md.qa.js','patcherrelativepath':'.','type':'TEXT','implicit':1})
    for e in p['lines']:
        s,so=e['patchline']['source'];d,di=e['patchline']['destination']
        assert s in boxes and d in boxes and so<boxes[s]['numoutlets'] and di<boxes[d]['numinlets'],e
    assert not any(e['patchline']['destination'][0]=='plugout' for e in p['lines'])
    assert not any(e['patchline']['destination']==['qa_silent_dac',1] for e in p['lines'])
    return doc

def write(firmware):
    if not firmware.is_file():raise SystemExit('Firmware file not found: '+str(firmware))
    (ROOT/'artifacts').mkdir(exist_ok=True)
    name='MD Integration Verification'
    max_doc=build_qa(firmware,'max');(DEV/(name+'.maxpat')).write_text(json.dumps(max_doc,indent=2,ensure_ascii=False)+'\n')
    live_doc=build_qa(firmware,'live');payload=(json.dumps(live_doc,indent=2,ensure_ascii=False)+'\n\0').encode()
    blob=b'ampf'+struct.pack('<I',4)+b'iiii'+b'meta'+struct.pack('<II',4,1)+b'ptch'+struct.pack('<I',len(payload))+payload
    (DEV/(name+'.amxd')).write_bytes(blob)
    assert json.loads(blob[32:].rstrip(b'\0'))==live_doc
    print('Built QA-only Max/Live variants. They will write artifacts/{max,live}-integration.{json,wav} when run.')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--firmware',type=Path,required=True,help='Machinedrum UW OS 1.63 .syx file')
    args=parser.parse_args();write(args.firmware.expanduser().resolve())
