// Targeted native regressions found during the post-release audit.
#include "md_processor.h"
#include <iostream>
#include <vector>
#include <cmath>
#include <stdexcept>
using namespace mdmax;
struct Stereo { std::vector<double> l,r; };
static void require(bool value,const char* why) { if(!value) throw std::runtime_error(why); }
static Stereo render(Processor& p,int frames) {
    Stereo out; double l[64]{},r[64]{};
    for(int at=0;at<frames;at+=64) {
        int n=std::min(64,frames-at); p.process(nullptr,nullptr,l,r,n);
        out.l.insert(out.l.end(),l,l+n);out.r.insert(out.r.end(),r,r+n);
    }
    require(!p.fault.load(),"DSP fault"); return out;
}
static double energy(const std::vector<double>& x) {
    double sum=0;for(double v:x){require(std::isfinite(v),"non-finite audio");sum+=v*v;}return sum/x.size();
}
static void silent(const Stereo& s,const char* why) { require(energy(s.l)==0 && energy(s.r)==0,why); }
static double difference(const std::vector<double>& a,const std::vector<double>& b) {
    double sum=0;for(size_t i=0;i<a.size();++i)sum+=std::abs(a[i]-b[i]);return sum/a.size();
}
static Stereo voice(const std::string& path,int pan,int velocity,double bpm=120,bool delay=false) {
    Processor p;p.stage(std::make_unique<Session>(path));
    p.send({Op::Machine,0,20});p.send({Op::Param,0,1,20});p.send({Op::Param,0,18,pan});
    if(delay){p.send({Op::Param,0,19,100});p.send({Op::Master,1,0,48});}
    p.send({Op::Tempo,0,0,0,bpm});render(p,4096);p.send({Op::Trigger,0,velocity});return render(p,88200);
}
static void panicOverflow(const std::string& path) {
    Processor p;p.stage(std::make_unique<Session>(path));
    p.send({Op::Machine,0,1});p.send({Op::Param,0,1,127});p.send({Op::Param,0,18,0});
    p.send({Op::Machine,1,20});p.send({Op::Param,1,18,127});p.send({Op::Trigger,0,100});
    require(energy(render(p,4096).l)>1e-5,"continuous voice did not start");p.triggeredTracks.exchange(0);
    for(int i=0;i<5000;++i)p.send({Op::Trigger,0,100});
    require(p.dropped.load()>0,"queue did not overflow");
    const bool accepted=p.send({Op::Panic});
    auto immediately=render(p,4096);p.maintenance();auto settled=render(p,4096);
    const auto staleActivity=p.triggeredTracks.exchange(0);
    require(p.send({Op::Trigger,1,100}),"queue did not recover after Panic");auto next=render(p,4096);
    std::cout<<"full_queue_panic accepted="<<accepted<<" immediate="<<energy(immediately.l)
        <<" settled="<<energy(settled.l)<<" stale_activity="<<staleActivity
        <<" next_right_track_left="<<energy(next.l)<<" right="<<energy(next.r)<<"\n";
    require(accepted,"Panic dropped by full queue");
    silent(immediately,"Panic failed to mute immediately");silent(settled,"Panic failed to reset full queue");
    require(staleActivity==0,"pre-Panic queued trigger survived");
    require(energy(next.l)<energy(next.r)*1e-6 && energy(next.r)>1e-8,"Panic allowed old left continuous voice to return");
    require(p.triggeredTracks.exchange(0)==(1u<<1),"new trigger after full-queue Panic was lost");
    // A second Panic arriving while the first reset is being serviced must not
    // lose the newest post-Panic note or revive the intervening old note.
    p.send({Op::Panic});p.send({Op::Trigger,0,100});silent(render(p,64),"first repeated Panic audible");
    p.send({Op::Panic});p.send({Op::Trigger,1,100});p.maintenance();
    silent(render(p,64),"second repeated Panic audible");p.maintenance();auto last=render(p,4096);
    require(p.triggeredTracks.exchange(0)==(1u<<1),"repeated Panic kept an intervening stale note");
    require(energy(last.l)<energy(last.r)*1e-6 && energy(last.r)>1e-8,"repeated Panic did not preserve only the newest note");
    // Existing knob edits still apply after Panic; only earlier notes expire.
    p.send({Op::Param,1,18,0});p.send({Op::Panic});p.send({Op::Trigger,1,100});
    silent(render(p,64),"Panic with pending parameter audible");p.maintenance();render(p,4096);p.send({Op::Trigger,1,100});auto edited=render(p,4096);
    std::cout<<"panic_pending_pan left="<<energy(edited.l)<<" right="<<energy(edited.r)<<"\n";
    require(energy(edited.l)>1e-8 && energy(edited.r)<energy(edited.l)*1e-6,"Panic discarded a queued knob edit");
    std::cout<<"full_queue_repeated_panic_preserves_controls PASS\n";
}
static void firstLoadAfterPanic(const std::string& path) {
    Processor p;
    p.send({Op::Trigger,0,100});p.send({Op::Panic});p.send({Op::Trigger,2,100});
    silent(render(p,64),"unloaded engine audible");
    p.beginFirmwareLoad();p.stage(std::make_unique<Session>(path));
    require(p.send({Op::Trigger,1,100}),"fresh post-stage note rejected");
    // No maintenance call: an already-silent new OS must not perform a second
    // expensive firmware reset to satisfy the earlier unloaded Panic.
    require(energy(render(p,4096).l)>1e-8,"prior unloaded Panic delayed the first fresh note");
    require(p.triggeredTracks.exchange(0)==2,"pre-load stale note survived new firmware");
    p.stage(std::make_unique<Session>(path));
    p.send({Op::Trigger,0,100});p.send({Op::Panic});p.send({Op::Trigger,1,100});
    require(energy(render(p,4096).l)>1e-8,"Panic after stage delayed a fresh note");
    require(p.triggeredTracks.exchange(0)==2,"fresh-session Panic resurrected an earlier queued note");
    p.maintenance();
    std::cout<<"unloaded_and_staged_panic_stale_notes_new_note_immediate PASS\n";
}
static void reloadAndOverflow(const std::string& path) {
    Processor p;p.stage(std::make_unique<Session>(path));
    p.send({Op::Machine,0,1});p.send({Op::Param,0,1,127});p.send({Op::Trigger,0,100});
    require(energy(render(p,4096).l)>1e-5,"reload continuous voice did not start");
    p.send({Op::Trigger,0,100});p.beginFirmwareLoad();
    bool rejected=false;try{p.stage(std::make_unique<Session>("/this-file-does-not-exist-80123.syx"));}catch(...){rejected=true;}
    require(rejected && !p.ready.load(),"failed reload retained ready state");
    silent(render(p,4096),"failed reload retained old audio");
    p.send({Op::Trigger,0,100});silent(render(p,4096),"post-failure trigger revived old audio");
    require(p.triggeredTracks.exchange(0)==0,"failed reload acknowledged a stale note");
    // Replacing a staged session before audio accepts it must cancel that pending
    // generation too, including its queued note.
    p.stage(std::make_unique<Session>(path));p.send({Op::Trigger,0,100});p.beginFirmwareLoad();
    silent(render(p,4096),"cancelled pending firmware became active");require(!p.ready.load(),"cancelled pending firmware became ready");
    p.beginFirmwareLoad();p.stage(std::make_unique<Session>(path));
    silent(render(p,4096),"old-generation note survived successful reload");require(p.ready.load(),"successful reload not ready");
    p.send({Op::Trigger,0,100});require(energy(render(p,4096).l)>1e-8,"fresh note after reload missing");
    require(p.triggeredTracks.exchange(0)==1,"fresh generation activity missing");
    for(int i=0;i<5000;++i)p.send({Op::Param,0,0,64});
    require(p.dropped.load()>0,"control overflow not counted");render(p,4096);
    require(p.ready.load() && !p.fault.load(),"recoverable overflow disabled engine");
    require(p.send({Op::Trigger,1,100}),"overflow did not recover");render(p,4096);
    require(p.triggeredTracks.exchange(0)==2,"note after overflow not accepted");p.maintenance();
    std::cout<<"failed_reload_silence_pending_cancellation_generation_recovery_control_overflow PASS\n";
}
int main(int argc,char** argv) {
    if(argc<2||argc>3)return 2;std::cout.setf(std::ios::unitbuf);
    try {
        const std::string path=argv[1];
        if(argc==3){panicOverflow(path);return 0;}
        panicOverflow(path);firstLoadAfterPanic(path);reloadAndOverflow(path);
        auto left=voice(path,0,100),right=voice(path,127,100),quiet=voice(path,0,32),loud=voice(path,0,127);
        require(energy(left.l)>1e-8 && energy(left.r)<energy(left.l)*1e-6,"PAN left routing incorrect");
        require(energy(right.r)>1e-8 && energy(right.l)<energy(right.r)*1e-6,"PAN right routing incorrect");
        require(energy(loud.l)>energy(quiet.l)*4,"MIDI velocity does not change level");
        std::cout<<"stereo_pan_and_velocity PASS velocity_ratio="<<energy(loud.l)/energy(quiet.l)<<"\n";
        auto slow=voice(path,64,100,400,true),fast=voice(path,64,100,800,true),maximum=voice(path,64,100,999,true);
        require(difference(slow.l,fast.l)>1e-4,"tempo above 400 remains clamped");
        require(difference(fast.l,maximum.l)>1e-4 && energy(maximum.l)>1e-8,"999 BPM delay not distinct/finite/audible");
        std::cout<<"tempo400_800_999 PASS delta400_800="<<difference(slow.l,fast.l)<<" delta800_999="<<difference(fast.l,maximum.l)<<"\n";
        std::cout<<"PASS: native audit regressions\n";return 0;
    }catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}
}
