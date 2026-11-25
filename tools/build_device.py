#!/usr/bin/env python3
"""Build MD Drum Engine, a firmware-backed Max for Live instrument without a sequencer.

The generated .amxd contains the patch only. Place mdcoreengine~.mxo,
mdparameterfocus.mxo, md.bridge.js and md.panel.js beside it. A user's firmware is selected at runtime and is never embedded.
"""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEV = ROOT / 'device'
MACHINES = [(1,'GND-SN'),(2,'GND-NS'),(3,'GND-IM')]
MACHINES += list(zip(range(16,29),['TRX-BD','TRX-SD','TRX-XT','TRX-CP','TRX-RS','TRX-CB','TRX-CH','TRX-OH','TRX-CY','TRX-MA','TRX-CL','TRX-XC','TRX-B2']))
MACHINES += list(zip(range(32,40),['EFM-BD','EFM-SD','EFM-XT','EFM-CP','EFM-RS','EFM-CB','EFM-HH','EFM-CY']))
MACHINES += list(zip(range(48,64),['E12-BD','E12-SD','E12-HT','E12-LT','E12-CP','E12-RS','E12-CB','E12-CH','E12-OH','E12-RC','E12-CC','E12-BR','E12-TA','E12-TR','E12-SH','E12-BC']))
MACHINES += list(zip(range(64,73),['P-I-BD','P-I-SD','P-I-MT','P-I-ML','P-I-MA','P-I-RS','P-I-RC','P-I-CC','P-I-HH']))
DEFAULT_IDS = [16,17,18,19,20,21,22,23,24,25,26,27,32,33,52,60]
DEFAULT_SYN = [[64,64,0,0,0,0,0,0],[64,32,0,64,64,64,64,0],[64,48,48,102,64,0,0,0],[64,64,127,64,64,32,32,64],[64,32,0,0,0,0,0,0],[64,64,64,0,64,64,0,0],[32,32,64,64,64,0,0,0],[64,64,64,64,64,0,0,0],[64,64,64,64,64,64,0,0],[32,32,0,0,64,64,64,64],[64,32,64,0,64,0,0,0],[64,32,32,96,0,0,0,0],[36,76,64,55,64,64,32,127],[64,55,64,64,64,32,44,16],[64,127,0,0,0,0,64,64],[64,96,0,0,0,0,64,64]]
DEFAULT_FX = [0,0,64,64,0,127,0,0,0,100,64,0,0,64,0,0]
MASTER_DEFAULTS = [[0,0,64,64,0,127,127,127],[24,0,0,32,0,127,0,127],[64,64,64,64,64,64,64,64],[0,64,127,0,0,0,64,0]]
MASTER_LABELS = [['DVOL','PRED','DEC','DAMP','HP','LP','GATE','LEV'],['TIME','MOD','MFRQ','FB','FLTF','FLTW','MONO','LEV'],['LF','LG','HF','HG','PF','PG','PQ','GAIN'],['ATCK','REL','TRHD','RTIO','KNEE','HP','OUTG','MIX']]
LFO_MAX = [15,23,5,5,2]
LFO_LABELS = ['Destination Track','Destination Param','Shape 1','Shape 2','Mode']

class Patch:
    def __init__(self):
        self.boxes=[]; self.lines=[]; self.params={}; self.banks={}
    def box(self, ident, text='', kind='newobj', ni=1, no=1, **kw):
        box={'id':ident,'maxclass':kind,'numinlets':ni,'numoutlets':no,
             'patching_rect':[24,290+len(self.boxes)*25,220,22]}
        if no: box['outlettype']=['']*no
        if text: box['text']=text
        box.update(kw);self.boxes.append({'box':box});return ident
    def wire(self, source, dest, so=0, di=0):
        self.lines.append({'patchline':{'source':[source,so],'destination':[dest,di]}})
    def parameter(self, ident, name, default, maximum=127, choices=None, floating=False, rect=None):
        attrs={'parameter_longname':name,'parameter_shortname':name,'parameter_type':0 if floating else 1,
               'parameter_mmin':0.,'parameter_mmax':float(maximum),'parameter_initial':[default],
               'parameter_initial_enable':1,'parameter_invisible':0,'parameter_unitstyle':1 if floating else 0}
        if choices:
            attrs.update(parameter_type=2,parameter_enum=choices,parameter_mmax=len(choices)-1)
        self.box(ident,kind='live.numbox',no=2,varname=ident,parameter_enable=1,
                 patching_rect=rect or [24,400,100,20],saved_attribute_attributes={'valueof':attrs})
        self.params[ident]=[name,name,0]
        pre=ident+'_pre';self.box(pre,'prepend control '+ident,patching_rect=[(rect or [24])[0],(rect or [24,400])[1]+22,180,20])
        self.wire(ident,pre);self.wire(pre,'bridge')
        return name
    def bank(self, name, parameters):
        idx=len(self.banks);self.banks[str(idx)]={'index':idx,'name':name,'parameters':(parameters+['-']*8)[:8]}
    def document(self):
        ids={item['box']['id']:item['box'] for item in self.boxes}
        assert len(ids)==len(self.boxes),'Duplicate box IDs'
        for item in self.lines:
            line=item['patchline'];s,so=line['source'];d,di=line['destination']
            assert s in ids and d in ids and so<ids[s]['numoutlets'] and di<ids[d]['numinlets'],line
        assert len(self.params)==514,len(self.params)
        return {'patcher':{'fileversion':1,'appversion':{'major':9,'minor':0,'revision':4,'architecture':'arm64','modernui':1},
                'classnamespace':'box','rect':[60,80,1120,700],'openrect':[0,0,757,169],
                'openinpresentation':1,'devicewidth':757,'default_fontname':'Arial','default_fontsize':12,
                'bglocked':1,'statusbarvisible':2,'toolbarvisible':1,'boxes':self.boxes,'lines':self.lines,
                'parameters':dict(self.params,parameterbanks=self.banks,inherited_shortname=1),
                'dependency_cache':[{'name':name,'patcherrelativepath':'.','type':typ,'implicit':1}
                    for name,typ in [('md.bridge.js','TEXT'),('md.panel.js','TEXT'),('mdcoreengine~.mxo','iLaX'),('mdparameterfocus.mxo','iLaX')]],'autosave':0}}

def build():
    p=Patch();b=p.box;w=p.wire
    b('panel',kind='jsui',no=1,filename='md.panel.js',jsarguments=[],parameter_enable=0,
      varname='md_panel',patching_rect=[0,0,757,169],presentation=1,presentation_rect=[0,0,757,169],border=0)
    # Live's device strip has a fixed height of169px. The same vector panel is
    # proportionally scaled here; its full-size editor is an embedded popup.
    editor={'fileversion':1,'classnamespace':'box','rect':[100,100,1120,250],
            'openrect':[100,100,1120,250],'openinpresentation':1,'toolbarvisible':0,
            'statusbarvisible':2,'boxes':[
                {'box':{'id':'editor_in','maxclass':'newobj','text':'inlet','numinlets':0,'numoutlets':1,'patching_rect':[16,280,40,22]}},
                {'box':{'id':'editor_panel','maxclass':'jsui','filename':'md.panel.js','jsarguments':['editor'],
                        'numinlets':1,'numoutlets':1,'parameter_enable':0,'border':0,
                        'patching_rect':[0,0,1120,250],'presentation':1,'presentation_rect':[0,0,1120,250]}},
                {'box':{'id':'editor_out','maxclass':'newobj','text':'outlet','numinlets':1,'numoutlets':0,'patching_rect':[16,320,40,22]}}],
            'lines':[{'patchline':{'source':['editor_in',0],'destination':['editor_panel',0]}},
                     {'patchline':{'source':['editor_panel',0],'destination':['editor_out',0]}}]}
    b('editor','p MD Editor',patcher=editor)
    b('open_editor','open','message');b('editor_control','pcontrol')
    w('open_editor','editor_control');w('editor_control','editor');w('editor','bridge');w('bridge','editor',1)
    b('bridge','js md.bridge.js',no=4,varname='md_state',patching_rect=[24,300,190,22])
    b('engine','mdcoreengine~',no=3,outlettype=['signal','signal',''],patching_rect=[270,300,120,22])
    b('engine_pre','prepend engine',patching_rect=[410,300,120,22])
    w('panel','bridge');w('bridge','panel',1);w('bridge','engine');w('engine','engine_pre',2);w('engine_pre','bridge')
    # Persistent JSON carries kit, view and external firmware path. Live parameters
    # retain stable per-track identities, independent of the editor selection.
    b('saved_state','pattr md_saved @bindto md_state @parameter_enable 1',no=3,varname='md_saved',
      saved_object_attributes={'parameter_enable':1,'parameter_mappable':0},
      saved_attribute_attributes={'valueof':{'parameter_longname':'MD saved state','parameter_shortname':'State',
       'parameter_type':3,'parameter_invisible':1,'parameter_initial_enable':0}},restore=[''])
    p.params['saved_state']=['MD saved state','State',0]
    b('device','live.thisdevice',no=3);b('load','loadbang',ni=0);b('defer','deferlow');b('init','init','message')
    w('device','defer');w('load','defer');w('defer','init');w('init','bridge')
    b('device_ready_defer','deferlow');b('device_ready','thisdeviceready','message')
    w('device','device_ready_defer');w('device_ready_defer','device_ready');w('device_ready','bridge')
    # Native MIDI mapping, including note-off rejection, avoids JS scheduler jitter.
    b('notein','notein',no=3)
    # Max expr has no if() function. Native split routes an inclusive interval
    # left and everything else right; unconnected invalid notes remain silent.
    b('note_range','split 36 51',ni=3,no=2)
    b('note_offset','- 36',ni=2)
    b('note_alias','split 0 15',ni=3,no=2)
    b('note_pack','pack i i',ni=2);b('note_gate','if $i1 >= 0 && $i2 > 0 then $i1 $i2')
    b('trigger_pre','prepend trigger');b('engine_ready_gate','gate 1 0',ni=2)
    w('notein','note_pack',1,1);w('notein','note_range')
    w('note_range','note_offset');w('note_offset','note_pack')
    w('note_range','note_alias',1);w('note_alias','note_pack')
    w('note_pack','note_gate');w('note_gate','trigger_pre');w('trigger_pre','engine_ready_gate',0,1);w('engine_ready_gate','engine')
    # MIDI All Sound Off stops held voices and FX tails. All Notes Off (CC123)
    # retains the drum engine's one-shot note-off behavior.
    b('all_sound_off','ctlin 120',no=2);b('all_sound_off_panic','panic','message')
    w('all_sound_off','all_sound_off_panic');w('all_sound_off_panic','engine')
    # Poll host tempo only. Transport state never gates notes or free LFOs.
    b('tempo_on','1','message');b('tempo_poll','qmetro 100',ni=2);b('transport','transport',ni=7,no=9)
    b('tempo_change','change 0.');b('tempo_pre','prepend hosttempo')
    w('defer','tempo_on');w('tempo_on','tempo_poll');w('tempo_poll','transport');w('transport','tempo_change',4);w('tempo_change','tempo_pre');w('tempo_pre','bridge')
    # Runtime firmware selection; no firmware bytes or machine dumps in the device.
    b('actions','route loadfirmware ready openeditor focusparameter savekit loadkit kitname',no=8);b('dialog','opendialog',no=2);b('native_path','conformpath native absolute',no=2)
    b('path_result','pack s i',ni=2);b('firmware_pre','prepend firmwarepathchecked');b('dialog_cancel','dialogcancel','message')
    w('bridge','actions',3);w('actions','open_editor',2);w('actions','engine_ready_gate',1);w('actions','dialog');w('dialog','native_path');w('native_path','path_result',1,1);w('native_path','path_result');w('path_result','firmware_pre');w('firmware_pre','bridge');w('dialog','dialog_cancel',1);w('dialog_cancel','bridge')
    # A jsui click must select the permanent native parameter for Live's LFO Map.
    # This helper requests host focus without writing a value or rotating identities.
    b('parameter_focus_pre','prepend focus');b('parameter_focus','mdparameterfocus',varname='md_parameter_focus')
    w('actions','parameter_focus_pre',3);w('parameter_focus_pre','parameter_focus')
    # Kit files: the user picks where to save and what to load; the bridge
    # reads/writes the JSON itself. A separate opendialog keeps the OS chooser intact.
    b('kit_name','prepend name');b('kit_save','savedialog',no=3,outlettype=['','',''])
    b('kit_save_pre','prepend savekitpath');b('kit_open','opendialog',no=2);b('kit_open_pre','prepend loadkitpath')
    w('actions','kit_name',6);w('kit_name','kit_save');w('actions','kit_save',4);w('kit_save','kit_save_pre');w('kit_save_pre','bridge')
    w('actions','kit_open',5);w('kit_open','kit_open_pre');w('kit_open_pre','bridge')
    # Smooth output changes for UI and automation alike.
    b('gain_pack','pack 0.7 20',ni=2);b('gain_line','line~ 0.7',ni=2,no=2,outlettype=['signal','bang'])
    b('gain_left','*~',ni=2,outlettype=['signal']);b('gain_right','*~',ni=2,outlettype=['signal'])
    b('plugout','plugout~',ni=2,no=0)
    w('bridge','gain_pack',2);w('gain_pack','gain_line');w('gain_line','gain_left',0,1);w('gain_line','gain_right',0,1)
    w('engine','gain_left');w('engine','gain_right',1);w('gain_left','plugout');w('gain_right','plugout',0,1)
    for t in range(16):
        x=24+(t%8)*230;y=1550+(t//8)*1550;prefix=f'md_t{t+1:02d}_';label=f'T{t+1:02d}'
        machine=p.parameter(prefix+'machine',label+' Machine',[m[0] for m in MACHINES].index(DEFAULT_IDS[t]),choices=[m[1] for m in MACHINES],rect=[x,y,180,20])
        names=[]
        for k,default in enumerate(DEFAULT_SYN[t]+DEFAULT_FX):
            names.append(p.parameter(prefix+f'p{k+1:02d}',label+f' P{k+1:02d}',default,rect=[x,y+50*(k+1),180,20]))
        lfo=[]
        for k in range(5):
            lfo.append(p.parameter(prefix+f'lfo{k+1:02d}',label+' LFO '+LFO_LABELS[k],t if k==0 else 0,maximum=LFO_MAX[k],rect=[x,y+50*(25+k),180,20]))
        p.bank(label+' SYN',names[:8]);p.bank(label+' FX',names[8:16]);p.bank(label+' ROUTE',[machine]+names[16:21]);p.bank(label+' LFO',lfo+names[21:24])
    for g,group in enumerate(['Reverb','Delay','EQ','Dynamix']):
        names=[]
        for k in range(8):
            names.append(p.parameter(f'md_master{g}_{k+1:02d}',group+' '+MASTER_LABELS[g][k],MASTER_DEFAULTS[g][k],rect=[24+g*230,4700+50*k,180,20]))
        p.bank(group,names)
    name=p.parameter('md_gain','Master Gain',0.7,maximum=1,floating=True,rect=[960,4700,180,20]);p.bank('Output',[name])
    return p.document()

def write():
    DEV.mkdir(parents=True,exist_ok=True)
    doc=build();source=(json.dumps(doc,indent=2,ensure_ascii=False)+'\n').encode();payload=source+b'\0'
    (DEV/'MD Drum Engine.maxpat').write_bytes(source)
    wrapper=b'ampf'+struct.pack('<I',4)+b'iiii'+b'meta'+struct.pack('<II',4,1)+b'ptch'+struct.pack('<I',len(payload))+payload
    (DEV/'MD Drum Engine.amxd').write_bytes(wrapper)
    blob=(DEV/'MD Drum Engine.amxd').read_bytes()
    assert blob[:4]==b'ampf' and struct.unpack_from('<I',blob,28)[0]==len(blob)-32
    assert json.loads(blob[32:].rstrip(b'\0'))==doc
    print('Built MD Drum Engine.amxd + .maxpat: 513 automatable sound parameters, 16 tracks, stereo, no sequencer.')

if __name__=='__main__':write()
