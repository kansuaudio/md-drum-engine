// AGPL-3.0. Bridge custom-drawn controls to their existing Live parameters.
// No audio processing and no parameter values are changed here.
#include "ext.h"
#include "ext_obex.h"
#include "ext_parameter.h"
#include "jpatcher_api.h"
#include <cstdio>

struct MdParameterFocus { t_object object; void* outlet; };
static t_class* focusClass=nullptr;

static void error(MdParameterFocus* x,t_symbol* name,const char* reason,t_max_err code=MAX_ERR_GENERIC) {
    t_atom args[3];
    atom_setsym(args,name?name:gensym(""));
    atom_setsym(args+1,gensym(reason));
    atom_setlong(args+2,code);
    outlet_anything(x->outlet,gensym("error"),3,args);
}

static t_object* findParameter(t_object* patcher,t_symbol* name) {
    // Public SDK iterator APIs (also used by the SDK's iterator example).
    // Look in the helper's patcher first, then enclosing patchers so a helper
    // in an embedded editor can reach the device's original parameter objects.
    for(int depth=0;patcher&&depth<32;++depth,patcher=jpatcher_get_parentpatcher(patcher)) {
        for(auto* box=jpatcher_get_firstobject(patcher);box;box=jbox_get_nextobject(box))
            if(jbox_get_varname(box)==name) return jbox_get_object(box);
    }
    return nullptr;
}

static void focusDeferred(MdParameterFocus* x,t_symbol*,long argc,t_atom* argv) {
    if(argc!=1||atom_gettype(argv)!=A_SYM||!atom_getsym(argv)->s_name[0]) {
        error(x,gensym(""),"focus requires one parameter scripting name"); return;
    }
    const auto name=atom_getsym(argv);
    t_object* patcher=nullptr;
    const auto lookup=object_obex_lookup(x,gensym("#P"),&patcher);
    if(lookup!=MAX_ERR_NONE||!patcher) { error(x,name,"containing patcher unavailable",lookup); return; }
    auto* parameter=findParameter(patcher,name);
    if(!parameter) { error(x,name,"parameter not found"); return; }
    if(object_classname(parameter)!=gensym("live.numbox")) {
        error(x,name,"target is not a live.numbox"); return;
    }
    t_atom_long enabled=0;
    if(object_attr_getlong_array(parameter,gensym("parameter_enable"),1,&enabled)!=1||!enabled||!object_parameter_is_parameter(parameter)) {
        error(x,name,"target parameter is disabled"); return;
    }
    // parameter_mappable controls Max's keyboard/MIDI mappings. It is reported,
    // not used to reject Live focus, which is a separate parameter-system API.
    t_atom_long mappable=-1;
    object_attr_getlong_array(parameter,gensym("parameter_mappable"),1,&mappable);
    const bool inLive=object_parameter_is_in_Live(parameter)!=0;
    // ext_parameter.h explicitly directs callers to this function to set the
    // read-only PARAM_DATA_TYPE_FOCUS field. Live can observe that selection.
    const auto result=object_parameter_wants_focus(parameter);
    if(result!=MAX_ERR_NONE) { error(x,name,"parameter focus request failed",result); return; }
    t_atom args[3]; atom_setsym(args,name);atom_setlong(args+1,inLive);atom_setlong(args+2,mappable);
    // Success means the SDK accepted the focus request. Standalone Max reports
    // inLive=0; that result alone is not a claim of an Ableton mapping being made.
    outlet_anything(x->outlet,gensym("focused"),3,args);
}

static void focus(MdParameterFocus* x,t_symbol* selector,long argc,t_atom* argv) {
    // Never traverse/edit patcher or parameter state on the audio/scheduler
    // thread. Resolve fresh pointers on the main thread rather than caching UI.
    defer_low(x,(method)focusDeferred,selector,argc,argv);
}
static void assist(MdParameterFocus*,void*,long direction,long,char* text) {
    std::snprintf(text,512,direction==ASSIST_INLET?
        "focus <live.numbox scripting name>":
        "focused <name> <inLive> <Max-mappable>; error <name> <reason> <code>");
}
static void* create(t_symbol*,long,t_atom*) {
    auto* x=static_cast<MdParameterFocus*>(object_alloc(focusClass));
    if(x) x->outlet=outlet_new(x,nullptr);
    return x;
}
extern "C" void C74_EXPORT ext_main(void*) {
    auto* c=class_new("mdparameterfocus",(method)create,nullptr,sizeof(MdParameterFocus),nullptr,A_GIMME,0);
    class_addmethod(c,(method)focus,"focus",A_GIMME,0);
    class_addmethod(c,(method)assist,"assist",A_CANT,0);
    class_register(CLASS_BOX,c);focusClass=c;
}
