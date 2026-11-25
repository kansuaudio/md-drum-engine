// Real-Max probe of the exact resolver called by mdcoreengine~. No audio or DSP.
#include "md_path.h"
#include <filesystem>
#include <fstream>
struct PathProbe { t_object object; void* output; };
static t_class* probeClass=nullptr;
static void resolveDeferred(PathProbe* x,t_symbol*,long argc,t_atom* argv) {
    const auto id=argc>0?atom_getlong(argv):-1;
    try {
        if(argc!=2 || atom_gettype(argv+1)!=A_SYM)throw std::runtime_error("resolve requires case ID and one path symbol");
        const auto path=mdmax::resolveFirmwarePath(atom_getsym(argv+1)->s_name);
        std::error_code ec;const bool regular=std::filesystem::is_regular_file(path,ec);
        std::ifstream file(path,std::ios::binary);
        const bool readable=regular && bool(file);
        const auto bytes=regular?std::filesystem::file_size(path,ec):uintmax_t(-1);
        t_atom out[4];atom_setlong(out,id);atom_setsym(out+1,gensym(path.c_str()));atom_setlong(out+2,readable?1:0);atom_setlong(out+3,ec?-1:t_atom_long(bytes));
        outlet_anything(x->output,gensym("resolved"),4,out);
    } catch(const std::exception& e) {
        t_atom out[2];atom_setlong(out,id);atom_setsym(out+1,gensym(e.what()));
        outlet_anything(x->output,gensym("resolveerror"),2,out);
    }
}
static void resolve(PathProbe* x,t_symbol* s,long argc,t_atom* argv){defer_low(x,(method)resolveDeferred,s,argc,argv);}
static void* create(){auto* x=static_cast<PathProbe*>(object_alloc(probeClass));if(x)x->output=outlet_new(x,nullptr);return x;}
extern "C" void C74_EXPORT ext_main(void*) {
    probeClass=class_new("mdpathprobe",(method)create,nullptr,sizeof(PathProbe),nullptr,0);
    class_addmethod(probeClass,(method)resolve,"resolve",A_GIMME,0);class_register(CLASS_BOX,probeClass);
}
