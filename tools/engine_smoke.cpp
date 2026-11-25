#include "md_processor.h"
#include "util/Wav.h"
#include <fstream>
#include <iostream>
#include <numeric>
#include <limits>
#include <cstring>
#include <future>
using namespace mdmax;
static void require(bool ok,const char* why) { if(!ok) throw std::runtime_error(why); }
static double energy(const std::vector<double>& v) { double sum=0;for(auto x:v){require(std::isfinite(x),"non-finite output");sum+=x*x;}return v.empty()?0:sum/v.size(); }
static uint64_t hash(const std::vector<double>& v) { uint64_t h=1469598103934665603ULL;for(double x:v){uint64_t bits;std::memcpy(&bits,&x,8);for(int k=0;k<8;++k){h^=(bits>>(8*k))&255;h*=1099511628211ULL;}}return h; }
static double difference(const std::vector<double>& a,const std::vector<double>& b) {double sum=0;for(size_t i=0;i<std::min(a.size(),b.size());++i)sum+=std::abs(a[i]-b[i]);return sum/std::min(a.size(),b.size());}
static std::vector<double> process(Processor& p,int frames,int vector=64,bool pace=false) {
    std::vector<double> out;out.reserve(frames);
    std::vector<double> l(size_t(vector),0.),r(size_t(vector),0.);
    auto deadline=std::chrono::steady_clock::now();
    for(int at=0;at<frames;at+=vector){const int n=std::min(vector,frames-at);p.process(nullptr,nullptr,l.data(),r.data(),n);for(int i=0;i<n;++i){require(std::isfinite(l[i])&&std::isfinite(r[i]),"non-finite audio");out.push_back(l[i]);}
        if(pace){deadline+=std::chrono::nanoseconds(int64_t(n*1e9/48000));std::this_thread::sleep_until(deadline);}
    }
    require(!p.fault.load(),"emulator fault");require(p.underruns.load()==0,"sample timeline starved");return out;
}
static void configure(Processor& p,int machine=1,bool fx=false,bool lfo=false){
    p.send({Op::Machine,0,machine});
    if(machine==1)p.send({Op::Param,0,1,127});
    if(fx){p.send({Op::Param,0,16,110});p.send({Op::Param,0,15,70});}
    if(lfo){p.send({Op::Param,0,21,100});p.send({Op::Param,0,22,110});p.send({Op::Lfo,0,2,1});p.send({Op::Lfo,0,3,1});}
    p.send({Op::Trigger,0,110});
}
static std::vector<double> fixture(const std::string& path,int rate,int vector=64,bool pace=false){
    Processor p;p.prepare(rate,vector);p.stage(std::make_unique<Session>(path));configure(p);return process(p,rate,vector,pace);
}
static std::vector<double> reference(Session& s,int frames){std::vector<double> v;v.reserve(frames);for(int at=0;at<frames;at+=32){s.engine->render();s.check();for(int i=0;i<32&&at+i<frames;++i)v.push_back(s.engine->output()[i][2]/8388608.f);}return v;}
static std::vector<double> expectedHost(const std::vector<double>& core,int rate,int latency){
    if(rate==44100){std::vector<double> out(size_t(rate),0.);for(int i=latency;i<rate;++i)out[i]=core[size_t(i-latency)];return out;}
    mnm::dsp::History h;h.prepare(int(core.size()+2048));std::vector<float> f(core.begin(),core.end());h.push(f.data(),int(f.size()));
    mnm::dsp::SincKernel k;k.design(44100,rate);mnm::dsp::RateMap map;map.set(44100,rate);std::vector<float> taps(size_t(k.numTaps()));std::vector<double> out;out.reserve(rate);
    for(int i=0;i<rate;++i){auto pos=map.at(i-latency);const auto* t=k.taps(pos,taps.data());out.push_back(std::clamp(double(h.dot(pos.index-k.halfTaps()+1,t,k.numTaps())),-1.,1.));}return out;
}
static void activityChecks(const std::string& path) {
    Processor p;
    p.send({Op::Trigger,0,100}); process(p,64);
    require(p.triggeredTracks.exchange(0)==0,"unloaded engine acknowledged a trigger");
    p.stage(std::make_unique<Session>(path)); process(p,64);
    require(p.triggeredTracks.exchange(0)==0,"stale trigger survived a firmware generation");
    for(int track:{0,3,15})p.send({Op::Trigger,track,100});
    require(p.triggeredTracks.load()==0,"queued trigger acknowledged before audio accepted it");
    process(p,64);
    require(p.triggeredTracks.exchange(0)==((1u<<0)|(1u<<3)|(1u<<15)),"simultaneous track activity mask wrong");
    require(p.triggeredTracks.exchange(0)==0,"activity mask did not drain");
    for(auto c:{Command{Op::Trigger,-1,100},Command{Op::Trigger,16,100},Command{Op::Trigger,2,0},Command{Op::Trigger,2,-1}})p.send(c);
    process(p,64); require(p.triggeredTracks.exchange(0)==0,"invalid or note-off trigger flashed activity");
    p.send({Op::Trigger,5,100});process(p,64);require(p.triggeredTracks.load()==(1u<<5),"accepted trigger missing activity");
    p.send({Op::Panic});require(p.triggeredTracks.load()==0,"panic kept stale activity");
    p.send({Op::Trigger,9,100});process(p,64);require(p.triggeredTracks.load()==0,"panic-blocked trigger flashed early");
    p.maintenance();process(p,64);require(p.triggeredTracks.exchange(0)==(1u<<9),"panic retrigger not acknowledged after acceptance");
    p.send({Op::Trigger,4,100});process(p,64);require(p.triggeredTracks.load()==(1u<<4),"activity setup failed");
    p.stage(std::make_unique<Session>(path));require(p.triggeredTracks.load()==0,"new firmware kept old activity");
    process(p,64);require(p.triggeredTracks.exchange(0)==0,"firmware reload generated false activity");p.maintenance();
    std::cout<<"trigger_activity_accepted_notes_mask_drain_panic_reload PASS\n";
}
int main(int argc,char** argv){
    if(argc<3){std::cerr<<"engine-smoke firmware.syx output-directory\n";return 2;}
    std::cout.setf(std::ios::unitbuf);
    try{
        const std::string path=argv[1],dir=argv[2];
        activityChecks(path);
        if(argc>3 && std::string(argv[3])=="--activity-only")return 0;
        std::vector<int> ids;
        {Session s(path);std::ofstream(dir+"/machine-catalog.json")<<s.catalog();for(auto& m:s.firmware.machines)if(supported(m))ids.push_back(m.id);require(ids.size()==49,"catalog does not have49 machines");}
        {Processor p;p.stage(std::make_unique<Session>(path));auto idle=process(p,4096);require(energy(idle)==0,"idle engine audible");std::cout<<"idle_energy=0\n";}
        double pitch=0;
        for(int rate:{44100,48000,96000}){
            Processor p;p.prepare(rate);p.stage(std::make_unique<Session>(path));configure(p);
            const auto t=std::chrono::steady_clock::now();auto a=process(p,rate);double seconds=std::chrono::duration<double>(std::chrono::steady_clock::now()-t).count();
            auto b=fixture(path,rate,127);require(a==b,"offline audio differs with callback vector size");
            auto c=fixture(path,rate);require(a==c,"repeat offline fixture is not sample-identical");
            Session ref(path);ref.setMachine(0,1);ref.tracks[0].params[1]=127;ref.pushTrack(0);ref.trigger(0,110);
            auto expected=expectedHost(reference(ref,44132),rate,p.latencySamples());
            require(a==expected,"reported wrapper latency does not match sample-exact engine reference");
            require(energy(a)>1e-7,"host output silent");int crossings=0;for(int i=rate/10+1;i<rate/2;++i)if(a[i-1]<=0&&a[i]>0)++crossings;double hz=crossings/.4;if(!pitch)pitch=hz;require(std::abs(hz-pitch)<pitch*.01,"pitch changed at host sample rate");
            std::vector<int32_t> pcm;for(auto x:a){pcm.push_back(int32_t(x*8388607));pcm.push_back(int32_t(x*8388607));}require(mnm::util::writeWav24(dir+"/smoke-"+std::to_string(rate)+".wav",pcm,2,rate),"WAV write failed");
            std::cout<<"rate="<<rate<<" latency_samples="<<p.latencySamples()<<" sinc_half="<<p.outputHalfTaps()<<" hash="<<hash(a)<<" measured_hz="<<hz<<" offline_wall_seconds="<<seconds<<" underruns="<<p.underruns.load()<<"\n";
        }
        // All actual firmware voices, not just one representative per family.
        double maxFirstMs=0;int slowestMachine=0;
        for(int id:ids){Processor p;p.stage(std::make_unique<Session>(path));configure(p,id);
            double l[64]{},r[64]{};auto first=std::chrono::steady_clock::now();p.process(nullptr,nullptr,l,r,64);
            const double ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-first).count();
            if(ms>maxFirstMs){maxFirstMs=ms;slowestMachine=id;}
            auto v=process(p,11025);require(energy(v)>1e-12,"catalog machine rendered silence");std::cout<<"machine="<<id<<" energy="<<energy(v)<<" first_callback_ms="<<ms<<"\n";
        }
        std::cout<<"all49_first_callback_max_ms="<<maxFirstMs<<" machine="<<slowestMachine<<"\n";
        {
            Processor p;p.stage(std::make_unique<Session>(path));
            // An untriggered warm track must stay gated while automation changes
            // machines, long decays, LFOs, distortion and sends on all 16 tracks.
            for(int id:ids){
                for(int t=0;t<16;++t){p.send({Op::Machine,t,id});for(int k=0;k<24;++k)p.send({Op::Param,t,k,(k*19+t*7+id)%128});p.send({Op::Param,t,1,127});p.send({Op::Param,t,19,127});p.send({Op::Param,t,20,127});}
                require(energy(process(p,2048))==0,"knob edits awakened an untriggered warm voice");
            }
            require(energy(process(p,44100))==0,"untriggered track leaked a delayed tail");
            p.send({Op::Machine,15,16});p.send({Op::Trigger,15,110});require(energy(process(p,11025))>1e-10,"arming track 16 lost its first note");
            std::cout<<"untriggered_automation_all49_all16_silent PASS\n";
        }
        {
            Processor a,b,c;a.stage(std::make_unique<Session>(path));b.stage(std::make_unique<Session>(path));c.stage(std::make_unique<Session>(path));configure(a);configure(b,1,true);configure(c,1,false,true);
            auto dry=process(a,22050),fx=process(b,22050),lfo=process(c,22050);require(difference(dry,fx)>1e-4,"FX had no effect");require(difference(dry,lfo)>1e-4,"LFO had no effect");std::cout<<"track_fx_difference="<<difference(dry,fx)<<" lfo_difference="<<difference(dry,lfo)<<"\n";
        }
        {
            Processor a,b;a.stage(std::make_unique<Session>(path));b.stage(std::make_unique<Session>(path));for(auto* p:{&a,&b}){p->send({Op::Machine,0,20});p->send({Op::Param,0,1,20});p->send({Op::Master,1,3,0});}b.send({Op::Param,0,19,127});for(auto* p:{&a,&b})p->send({Op::Trigger,0,110});
            auto dry=process(a,88200),wet=process(b,88200);require(difference(dry,wet)>1e-4,"delay send had no effect");std::cout<<"master_delay_difference="<<difference(dry,wet)<<"\n";
        }
        {
            Processor p;p.prepare(48000);p.stage(std::make_unique<Session>(path));
            for(int t=0;t<16;++t){p.send({Op::Param,t,21,80});p.send({Op::Param,t,22,30});p.send({Op::Trigger,t,110});}
            auto t=std::chrono::steady_clock::now();auto stress=process(p,96000,64);auto elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-t).count();require(energy(stress)>1e-6,"16-track stress silent");std::cout<<"stress16_two_audio_seconds_wall="<<elapsed<<" energy="<<energy(stress)<<"\n";
            // Panic gates immediately; rebuilding is deliberately outside process.
            p.send({Op::Panic});p.send({Op::Trigger,1,100});auto silence=process(p,256);require(energy(silence)==0,"panic not immediate");p.maintenance();auto retrig=process(p,24000);require(energy(retrig)>1e-8,"panic lost queued retrigger");p.maintenance();
            p.send({Op::Panic});process(p,256);p.maintenance();require(energy(process(p,24000))==0,"panic resurrected old effect tails");p.maintenance();std::cout<<"panic/retrigger/tails PASS\n";
        }
        {
            Processor p;p.prepare(48000);p.stage(std::make_unique<Session>(path));
            require(energy(process(p,96000))==0,"long idle produced sound");
            p.send({Op::Trigger,0,110});
            double l[64]{},r[64]{};const auto start=std::chrono::steady_clock::now();p.process(nullptr,nullptr,l,r,64);
            const double firstMs=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();
            auto hit=process(p,24000);require(energy(hit)>1e-7,"first hit after idle was lost");
            std::cout<<"first_hit_after_two_seconds_idle_callback_ms="<<firstMs<<" energy="<<energy(hit)<<"\n";
        }
        // Concurrent instances exercise upstream's process-global Musashi lock.
        {
            auto a=std::async(std::launch::async,[&]{return fixture(path,48000);});auto b=std::async(std::launch::async,[&]{return fixture(path,48000);});auto av=a.get(),bv=b.get();require(av==bv,"parallel instances diverged");std::cout<<"parallel_instances_hash="<<hash(av)<<"\n";
        }
        {
            Processor p;p.prepare(44100);p.stage(std::make_unique<Session>(path));configure(p);process(p,1000);
            p.prepare(96000);p.stage(std::make_unique<Session>(path));configure(p);auto restarted=process(p,96000);require(restarted==fixture(path,96000),"DSP restart kept stale converter audio");p.maintenance();
            // A pending newer generation must reject queued stale old commands.
            p.send({Op::Machine,0,72});p.stage(std::make_unique<Session>(path));configure(p);require(process(p,96000)==fixture(path,96000),"firmware replacement used stale commands");p.maintenance();std::cout<<"DSP_restart_and_firmware_generations PASS\n";
        }
        {Processor p;p.prepare(48000);p.stage(std::make_unique<Session>(path));configure(p);double in[64]{},l[64],r[64];in[0]=std::numeric_limits<double>::quiet_NaN();in[1]=std::numeric_limits<double>::infinity();p.send({Op::Param,-1,-3,-2});p.send({Op::Tempo,0,0,0,std::numeric_limits<double>::quiet_NaN()});p.process(in,in,l,r,64);for(int i=0;i<64;++i)require(std::isfinite(l[i])&&std::isfinite(r[i]),"NaN propagated");}
        auto realtime=fixture(path,48000,64,true);require(realtime==fixture(path,48000),"realtime playback differs from offline export");
        bool rejected=false;try{Session bad(dir+"/missing.syx");}catch(...){rejected=true;}require(rejected,"missing firmware accepted");
        std::cout<<"PASS: offline deterministic hashes, exact wrapper latency,49 voices, FX/LFO/delay,16track stress, panic, parallel instances, DSP restart, realtime match, NaN, missing firmware\n";return 0;
    }catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}
}
