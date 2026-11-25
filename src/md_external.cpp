// mdcoreengine~: Machinedrum OS sound engine for Max 8/9 on macOS (arm64, x86_64) and Windows x64.
#include "ext.h"
#include "ext_obex.h"
#include "z_dsp.h"
#include "md_processor.h"
#include "md_path.h"
#include <algorithm>
#include <cmath>
#include <cstdio>

struct MdObject { t_pxobject obj; mdmax::Processor* processor; void* info; void* clock; bool reportedFault; bool awaitingReady; uint64_t lastDrop; int lastLatency; };
static t_class* mdClass=nullptr;
static void info(MdObject* x,const char* selector,const char* text) { t_atom a; atom_setsym(&a,gensym(text)); outlet_anything(x->info,gensym(selector),1,&a); }
static void ready(MdObject* x,int value) { t_atom a; atom_setlong(&a,value); outlet_anything(x->info,gensym("ready"),1,&a); }
// A reply proves the embedded native external loaded before the bridge starts
// a firmware request. Without it, incompatible/missing externals look like ROM hangs.
static void engineInfoDeferred(MdObject* x,t_symbol*,long,t_atom*) {
#if defined(__aarch64__) || defined(__arm64__)
    const char* architecture="arm64";
#elif defined(__x86_64__) || defined(_M_X64)
    const char* architecture="x86_64";
#else
    const char* architecture="unsupported";
#endif
    t_atom a[2]; atom_setsym(a,gensym("1.0.4")); atom_setsym(a+1,gensym(architecture));
    outlet_anything(x->info,gensym("engineinfo"),2,a);
}
static void ping(MdObject* x) { defer_low(x,(method)engineInfoDeferred,nullptr,0,nullptr); }
static void loadError(MdObject* x,const char* text) {
    object_error(reinterpret_cast<t_object*>(x),"%s",text);
    info(x,"error",text);
}
static void firmwareDeferred(MdObject* x,t_symbol*,long argc,t_atom* argv) {
    if(!x->processor || argc<1 || atom_gettype(argv)!=A_SYM) { loadError(x,"firmware requires an absolute .syx path"); return; }
    x->processor->beginFirmwareLoad();
    x->awaitingReady=false; ready(x,0);
    info(x,"status","Loading Machinedrum OS…");
    try {
        auto session=std::make_unique<mdmax::Session>(mdmax::resolveFirmwarePath(atom_getsym(argv)->s_name));
        const std::string catalog=session->catalog();
        x->processor->stage(std::move(session)); x->reportedFault=false; x->awaitingReady=true;
        info(x,"catalog",catalog.c_str());
        info(x,"status","Initializing audio engine…");
    } catch(const std::exception& e) { loadError(x,e.what()); ready(x,0); }
    catch(...) { loadError(x,"Unable to initialize the firmware engine"); ready(x,0); }
}
static void firmware(MdObject* x,t_symbol* s,long n,t_atom* a) { defer_low(x,(method)firmwareDeferred,s,n,a); }
static bool ints(long argc,t_atom* a,int count,int* out) {
    if(argc<count) return false;
    for(int i=0;i<count;++i) { if(atom_gettype(a+i)!=A_LONG&&atom_gettype(a+i)!=A_FLOAT) return false; const double v=atom_getfloat(a+i); if(!std::isfinite(v)||v<-100000||v>100000) return false; out[i]=int(v); }
    return true;
}
static void machine(MdObject* x,t_symbol*,long n,t_atom* a) { int v[2]; if(ints(n,a,2,v)) x->processor->send({mdmax::Op::Machine,v[0],v[1]}); }
static void param(MdObject* x,t_symbol*,long n,t_atom* a) { int v[3]; if(ints(n,a,3,v)) x->processor->send({mdmax::Op::Param,v[0],v[1],v[2]}); }
static void lfo(MdObject* x,t_symbol*,long n,t_atom* a) { int v[3]; if(ints(n,a,3,v)) x->processor->send({mdmax::Op::Lfo,v[0],v[1],v[2]}); }
static void master(MdObject* x,t_symbol*,long n,t_atom* a) { int v[3]; if(ints(n,a,3,v)) x->processor->send({mdmax::Op::Master,v[0],v[1],v[2]}); }
static void trigger(MdObject* x,t_symbol*,long n,t_atom* a) { int v[2]; if(ints(n,a,2,v)) x->processor->send({mdmax::Op::Trigger,v[0],v[1]}); }
static void tempo(MdObject* x,double bpm) { if(std::isfinite(bpm)) x->processor->send({mdmax::Op::Tempo,0,0,0,bpm}); }
static void panic(MdObject* x) { x->processor->send({mdmax::Op::Panic}); }
static void statusDeferred(MdObject* x,t_symbol*,long,t_atom*) {
    if(!x->processor) return;
    auto& p=*x->processor;
    p.maintenance();
    const uint32_t activity=p.triggeredTracks.exchange(0,std::memory_order_relaxed);
    if(activity) { t_atom a; atom_setlong(&a,activity); outlet_anything(x->info,gensym("activity"),1,&a); }
    const int latency=p.latencySamples();
    if(latency!=x->lastLatency) { x->lastLatency=latency; t_atom a;atom_setlong(&a,latency);outlet_anything(x->info,gensym("latency"),1,&a); }
    if(x->awaitingReady&&p.ready.load(std::memory_order_acquire)) { x->awaitingReady=false; info(x,"status","OS 1.63 loaded · 16 tracks · FX + LFO"); ready(x,1); }
    if(p.fault.load()&&!x->reportedFault) { x->reportedFault=true; ready(x,0); info(x,"error","DSP emulation stopped after a fault; reload the OS file"); }
    const auto drops=p.dropped.load(); if(drops!=x->lastDrop) { x->lastDrop=drops; object_warn(reinterpret_cast<t_object*>(x),"Control queue full; %llu total messages dropped",static_cast<unsigned long long>(drops)); info(x,"warning","Control queue full; some commands were dropped"); }
}
static void status(MdObject* x) {
    // A Max clock can run in the high-priority scheduler/audio interrupt.
    // Session allocation, reclamation and outlet/UI messages always run low.
    defer_low(x,(method)statusDeferred,nullptr,0,nullptr);
    clock_delay(x->clock,20);
}
static void perform(MdObject* x,t_object*,double** ins,long numins,double** outs,long,long n,long,void*) {
    if(x->processor) x->processor->process(numins>0?ins[0]:nullptr,numins>1?ins[1]:nullptr,outs[0],outs[1],int(n));
    else { std::fill_n(outs[0],n,0.); std::fill_n(outs[1],n,0.); }
}
static void dsp64(MdObject* x,t_object* dsp,short*,double rate,long maxVector,long) {
    try { x->processor->prepare(rate,int(maxVector)); object_method(dsp,gensym("dsp_add64"),x,perform,0,nullptr); }
    catch(const std::exception& e) { info(x,"error",e.what()); }
}
static void assist(MdObject*,void*,long m,long a,char* s) { if(m==ASSIST_INLET) snprintf(s,512,a==0?"Messages / audio input L":"Audio input R"); else snprintf(s,512,a==0?"Audio L":a==1?"Audio R":"Engine status / catalog"); }
static void destroy(MdObject* x) { dsp_free(&x->obj); if(x->clock) object_free(x->clock); delete x->processor; }
static void* create(t_symbol*,long,t_atom*) {
    auto* x=static_cast<MdObject*>(object_alloc(mdClass)); if(!x) return nullptr;
    x->processor=nullptr; x->clock=nullptr; x->reportedFault=false; x->awaitingReady=false; x->lastDrop=0; x->lastLatency=-1;
    dsp_setup(&x->obj,2); x->obj.z_misc|=Z_NO_INPLACE;
    x->info=outlet_new(x,nullptr); outlet_new(x,"signal"); outlet_new(x,"signal");
    try { x->processor=new mdmax::Processor(); x->clock=clock_new(x,(method)status); clock_delay(x->clock,250); }
    catch(const std::exception& e) { object_error((t_object*)x,"%s",e.what()); object_free(x); return nullptr; }
    return x;
}
extern "C" void C74_EXPORT ext_main(void*) {
    auto* c=class_new("mdcoreengine~",(method)create,(method)destroy,sizeof(MdObject),nullptr,A_GIMME,0);
    class_addmethod(c,(method)ping,"ping",0);
    class_addmethod(c,(method)firmware,"firmware",A_GIMME,0);
    class_addmethod(c,(method)machine,"machine",A_GIMME,0); class_addmethod(c,(method)param,"param",A_GIMME,0);
    class_addmethod(c,(method)lfo,"lfo",A_GIMME,0); class_addmethod(c,(method)master,"master",A_GIMME,0);
    class_addmethod(c,(method)trigger,"trigger",A_GIMME,0); class_addmethod(c,(method)tempo,"tempo",A_FLOAT,0);
    class_addmethod(c,(method)panic,"panic",0); class_addmethod(c,(method)dsp64,"dsp64",A_CANT,0);
    class_addmethod(c,(method)assist,"assist",A_CANT,0); class_dspinit(c); class_register(CLASS_BOX,c); mdClass=c;
}
