// AGPL-3.0. Original Max integration; ModuleDrum retains its own credits.
#pragma once
#include "MdEngine.h"
#include "dsp/Resampler.h"
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace mdmax {
using Engine = mnm::md::Engine;
constexpr int kCoreFrames = 32;
constexpr std::array<int, 16> kKit{16,17,18,19,20,21,22,23,24,25,26,27,32,33,52,60};
constexpr std::array<int, 5> kLfoMax{15,23,5,5,2};
constexpr std::array<uint8_t, 16> kFx{0,0,64,64,0,127,0,0,0,100,64,0,0,64,0,0};
constexpr std::array<std::array<uint8_t,8>,4> kMaster{{{0,0,64,64,0,127,127,127},{24,0,0,32,0,127,0,127},{64,64,64,64,64,64,64,64},{0,64,127,0,0,0,64,0}}};
inline bool supported(const mnm::md::Machine& m) {
    return m.id < 80 && (m.family == "GND" || m.family == "TRX" || m.family == "EFM" || m.family == "E12" || m.family == "P-I");
}
inline std::string quoted(const std::string& s) {
    std::string o="\""; for (unsigned char c:s) { if(c=='"'||c=='\\') o+='\\'; if(c>=32) o+=char(c); } return o+'"';
}
struct SessionState {
    std::array<Engine::Track,16> tracks{};
    std::array<std::array<uint8_t,8>,4> master=kMaster;
    double tempo=120;
};
// Max paths are UTF-8. A narrow std::string on Windows would be read in the
// ANSI code page, so non-ASCII folder names need an explicit UTF-8 conversion.
inline std::filesystem::path fsPath(const std::string& utf8) {
#ifdef _WIN32
    return std::filesystem::u8path(utf8);
#else
    return std::filesystem::path(utf8);
#endif
}
struct Session {
    // Declaration order is intentional: engine retains a reference to firmware.
    mnm::md::Firmware firmware;
    std::unique_ptr<Engine> engine;
    std::array<Engine::Track,16> tracks{};
    std::array<std::array<uint8_t,8>,4> master=kMaster;
    double tempo=120;
    uint64_t generation=0;
    Session* retiredNext=nullptr;
    std::atomic<int> resetReferences{0};
    uint16_t armedMask=0;
    Session(const mnm::md::Firmware& fw,const SessionState& state): firmware(fw), engine(std::make_unique<Engine>(firmware)), tracks(state.tracks), master(state.master), tempo(state.tempo) {
        warmup();
    }
    SessionState snapshot() const { return {tracks,master,tempo}; }
    explicit Session(const std::string& path): firmware(mnm::md::loadFirmware(fsPath(path))), engine(std::make_unique<Engine>(firmware)) {
        defaultKit(); warmup();
    }
    void pushTrack(int t) {
        auto target=tracks[t];
        // Warmup runs real firmware voices. Keep each track's routing silent
        // until its first actual note, including after arbitrary knob edits.
        if(!(armedMask&(uint16_t(1)<<t))) target.level=0;
        engine->setTrack(t,target);
    }
    void trigger(int t,int velocity) {
        armedMask|=uint16_t(1)<<t; pushTrack(t);
        // Arming is a routing gate, not an audible volume fade. Jump this level
        // before the firmware tick so the first attack retains its full shape.
        engine->cpu().setLiveLevel(t,uint16_t(tracks[t].level)<<7);
        engine->cpu().setLevelTarget(t,tracks[t].level);
        engine->trig(t,tracks[t].machine,velocity);
    }
    void setMachine(int t,int id) {
        const auto* m=firmware.byId(id);
        if(!m || !supported(*m)) return;
        tracks[t].machine=id;
        std::copy(m->defaults.begin(),m->defaults.end(),tracks[t].params.begin());
        pushTrack(t);
    }
    void apply() { for(int t=0;t<16;++t) pushTrack(t); engine->setMasterFx(master); engine->setTempo(tempo); engine->snap(); }
    void defaultKit() {
        tracks={}; master=kMaster; tempo=120;
        for(int t=0;t<16;++t) {
            std::copy(kFx.begin(),kFx.end(),tracks[t].params.begin()+8);
            tracks[t].lfoConfig={uint8_t(t),0,0,0,0};
            setMachine(t,kKit[t]);
        }
    }
    void warmup() {
        // Main-thread preparation compiles the common first-note DSP paths for
        // every exposed machine. The underlying JIT may still compile unusual
        // parameter-dependent paths later; hard-realtime safety is not claimed.
        const auto saved=snapshot(); defaultKit(); apply();
        for(int i=0;i<16;++i) engine->render();
        for(const auto& m:firmware.machines) if(supported(m)) {
            setMachine(0,m.id); engine->trig(0,m.id,100);
            for(int i=0;i<8;++i) engine->render();
            check();
        }
        // Finish on a known finite voice with its final parameters already
        // applied. Changing DEC after a drain can reawaken an old envelope.
        defaultKit(); apply(); engine->render();
        engine->trig(0,kKit[0],100);
        int quiet=0;
        for(int i=0;i<44100*5/kCoreFrames && quiet<64;++i) {
            engine->render(); check();
            const auto& voice=engine->voiceBlock()[0];
            quiet=std::all_of(voice.begin(),voice.end(),[](int32_t v){return v==0;})?quiet+1:0;
        }
        if(quiet<64) throw std::runtime_error("firmware warmup did not settle");
        tracks=saved.tracks;master=saved.master;tempo=saved.tempo;apply();
        for(int i=0;i<16;++i) engine->render();
        check();
    }
    void check() const {
        if(engine->voices().faulted()) throw std::runtime_error(engine->voices().faultReason());
        if(engine->mixer().faulted()) throw std::runtime_error(engine->mixer().faultReason());
        if(engine->cpu().lastError()[0]) throw std::runtime_error(engine->cpu().lastError());
    }
    std::string catalog() const {
        std::ostringstream o; o<<'['; bool comma=false;
        for(const auto& m:firmware.machines) if(supported(m)) {
            if(comma) o<<','; comma=true;
            o<<"{\"id\":"<<m.id<<",\"name\":"<<quoted(m.name())<<",\"labels\":[";
            for(int k=0;k<8;++k) { if(k) o<<','; o<<quoted(m.labels[k]); }
            o<<"],\"defaults\":[";
            for(int k=0;k<8;++k) { if(k) o<<','; o<<int(m.defaults[k]); } o<<"]}";
        }
        o<<']'; return o.str();
    }
};
enum class Op:uint8_t { Machine,Param,Lfo,Master,Trigger,Tempo,Panic };
struct Command { Op op{}; int a=0,b=0,c=0; double value=0; uint64_t generation=0,panicSerial=0; };
// Bounded MPSC queue: Max scheduler and UI may both produce, audio alone consumes.
// A full queue drops the new command and increments a visible diagnostic counter.
template<class T,size_t N> class Queue {
    struct Cell { std::atomic<size_t> sequence; T value{}; };
    std::array<Cell,N> cells;
    alignas(64) std::atomic<size_t> write{0};
    alignas(64) size_t read=0;
public:
    Queue() { static_assert((N&(N-1))==0); for(size_t i=0;i<N;++i) cells[i].sequence.store(i); }
    bool push(const T& v) noexcept {
        size_t pos=write.load(std::memory_order_relaxed);
        // Bounded retries also bounds scheduler work under competing producers.
        for(int tries=0;tries<16;++tries) {
            auto& c=cells[pos&(N-1)]; const size_t seq=c.sequence.load(std::memory_order_acquire);
            const intptr_t diff=intptr_t(seq)-intptr_t(pos);
            if(diff==0) { if(write.compare_exchange_weak(pos,pos+1,std::memory_order_relaxed)) { c.value=v; c.sequence.store(pos+1,std::memory_order_release); return true; } }
            else if(diff<0) return false; else pos=write.load(std::memory_order_relaxed);
        }
        return false;
    }
    bool pop(T& v) noexcept {
        auto& c=cells[read&(N-1)];
        if(c.sequence.load(std::memory_order_acquire)!=read+1) return false;
        v=c.value; c.sequence.store(read+N,std::memory_order_release); ++read; return true;
    }
};
// Every engine call is driven by the host's sample clock. Offline export and
// realtime playback therefore produce the same samples. Upstream uses a global
// Musashi mutex and lazy DSP JIT compilation; this wrapper does not claim that
// the underlying emulator is hard-realtime safe.
class Processor {
    struct ResetRequest { Session* source=nullptr; SessionState state{}; uint64_t generation=0; };
    Queue<Command,4096> commands;
    Queue<ResetRequest,16> resets;
    std::atomic<Session*> pending{nullptr}, retired{nullptr};
    Session* active=nullptr; // audio thread only (destructor runs after DSP stops)
    Session* heldForReset=nullptr; // maintenance/main thread only
    std::atomic<uint64_t> generation{1},panicSerial{0};
    uint64_t acceptedPanicSerial=0; // audio thread only
    std::atomic<bool> muted{false}, resetPending{false};
    bool hasDeferred=false;
    Command deferred{};
    mnm::dsp::SincKernel toHost,toCore;
    mnm::dsp::RateMap hostMap,coreMap,coreCountMap;
    std::array<mnm::dsp::History,2> outHistory,inHistory;
    std::vector<float> outScratch,inScratch;
    std::array<int32_t,64> inputBlock{};
    double hostRate=44100;
    int64_t hostFrame=0,coreTicks=0;
    int coreFill=0;
    bool bypass=true;
    std::atomic<int> latency{32};
    uint64_t acceptedGeneration=0;

    static float finite(double x) noexcept { return std::isfinite(x)?float(std::clamp(x,-1.0,1.0)):0.f; }
    void clearPipeline() noexcept {
        hostFrame=coreTicks=0; coreFill=0; inputBlock.fill(0);
        for(auto& h:outHistory) h.clear(); for(auto& h:inHistory) h.clear();
    }
    void retire(Session* s) noexcept {
        if(!s) return;
        auto* head=retired.load(std::memory_order_relaxed);
        do { s->retiredNext=head; } while(!retired.compare_exchange_weak(head,s,std::memory_order_release,std::memory_order_relaxed));
    }
    void acceptPending() noexcept {
        if(auto* next=pending.exchange(nullptr,std::memory_order_acq_rel)) {
            // A fresh firmware session already fulfils any prior Panic: all
            // voices are unarmed. Same-generation resets must still observe a
            // second Panic that arrived while maintenance built the replacement.
            if(next->generation!=acceptedGeneration)
                acceptedPanicSerial=panicSerial.load(std::memory_order_acquire);
            retire(active); active=next; acceptedGeneration=next->generation;
            resetPending.store(false,std::memory_order_release); fault.store(false);
            clearPipeline();
        }
    }
    void apply(const Command& c) {
        auto& s=*active;
        switch(c.op) {
        case Op::Machine: if(c.a>=0&&c.a<16) s.setMachine(c.a,c.b); break;
        case Op::Param: if(c.a>=0&&c.a<16&&c.b>=0&&c.b<24) { s.tracks[c.a].params[c.b]=uint8_t(std::clamp(c.c,0,127)); s.pushTrack(c.a); } break;
        case Op::Lfo: if(c.a>=0&&c.a<16&&c.b>=0&&c.b<5) { s.tracks[c.a].lfoConfig[c.b]=uint8_t(std::clamp(c.c,0,kLfoMax[c.b])); s.pushTrack(c.a); } break;
        case Op::Master: if(c.a>=0&&c.a<4&&c.b>=0&&c.b<8) { s.master[c.a][c.b]=uint8_t(std::clamp(c.c,0,127)); s.engine->setMasterFx(s.master); } break;
        case Op::Trigger: if(c.a>=0&&c.a<16&&c.b>0) { s.trigger(c.a,std::clamp(c.b,1,127)); muted.store(false,std::memory_order_release); triggeredTracks.fetch_or(uint32_t(1)<<c.a,std::memory_order_relaxed); } break;
        case Op::Tempo: if(std::isfinite(c.value)) { s.tempo=std::clamp(c.value,20.,999.); s.engine->setTempo(s.tempo); } break;
        case Op::Panic: {
            muted.store(true,std::memory_order_release);
            triggeredTracks.store(0,std::memory_order_relaxed);
            // Keep audio gated while a new silent engine is built on the main
            // thread. Hold following commands so a new note cannot reveal old tails.
            s.resetReferences.fetch_add(1,std::memory_order_relaxed);
            if(resets.push({&s,s.snapshot(),acceptedGeneration})) resetPending.store(true,std::memory_order_release);
            else { s.resetReferences.fetch_sub(1,std::memory_order_relaxed); fault.store(true); ready.store(false); }
            break;
        }
        }
    }
    bool drain() {
        for(int n=0;n<1024;++n) {
            // Panic has its own lock-free mailbox, so a saturated controls queue
            // cannot drop it. A serial fence rejects every queued pre-Panic note.
            const auto serial=panicSerial.load(std::memory_order_acquire);
            if(serial!=acceptedPanicSerial) {
                acceptedPanicSerial=serial;
                apply({Op::Panic});
                return false;
            }
            Command c;
            if(hasDeferred) { c=deferred; hasDeferred=false; }
            else if(!commands.pop(c)) return true;
            if(c.generation<acceptedGeneration || (c.op==Op::Trigger && c.panicSerial<acceptedPanicSerial)) continue;
            if(c.generation>acceptedGeneration || c.panicSerial>acceptedPanicSerial) { deferred=c; hasDeferred=true; return false; }
            apply(c);
            if(resetPending.load(std::memory_order_acquire)||fault.load()) return false;
        }
        return true;
    }
    void renderBlock() {
        const auto start=std::chrono::steady_clock::now();
        active->engine->setInput(inputBlock.data()); active->engine->render(); active->check();
        const auto& block=active->engine->output();
        std::array<float,32> l{},r{};
        for(int i=0;i<32;++i) { l[i]=block[i][2]/8388608.f; r[i]=block[i][5]/8388608.f; }
        outHistory[0].push(l.data(),32); outHistory[1].push(r.data(),32);
        renderedFrames.fetch_add(32,std::memory_order_relaxed);
        renderNanos.fetch_add(uint64_t(std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now()-start).count()),std::memory_order_relaxed);
    }
public:
    std::atomic<bool> ready{false},fault{false};
    // Audio acknowledges accepted notes; the low-priority UI poll drains the mask.
    std::atomic<uint32_t> triggeredTracks{0};
    // underruns now means an internal sample-clock/converter invariant failed;
    // host rendering speed can never cause an underrun.
    std::atomic<uint64_t> underruns{0},dropped{0},renderedFrames{0},renderNanos{0};
    Processor() { prepare(44100); }
    ~Processor() {
        ResetRequest r; while(resets.pop(r)) if(r.source) r.source->resetReferences.fetch_sub(1);
        delete pending.exchange(nullptr); delete active;
        auto* s=retired.exchange(nullptr); while(s) { auto* next=s->retiredNext; delete s; s=next; }
        while(heldForReset) { auto* next=heldForReset->retiredNext;delete heldForReset;heldForReset=next; }
    }
    Processor(const Processor&)=delete; Processor& operator=(const Processor&)=delete;

    // Loading is a new generation even when reading/booting subsequently fails.
    // Keep an old sustained voice and its queued commands silent until a new OS
    // session is staged and a new note is accepted.
    void beginFirmwareLoad() {
        muted.store(true,std::memory_order_release);
        ready.store(false,std::memory_order_release);
        fault.store(false,std::memory_order_release);
        triggeredTracks.store(0,std::memory_order_relaxed);
        generation.fetch_add(1,std::memory_order_acq_rel);
        delete pending.exchange(nullptr,std::memory_order_acq_rel);
    }
    // Main thread only. No Session construction or destruction in process().
    void stage(std::unique_ptr<Session> s) {
        triggeredTracks.store(0,std::memory_order_relaxed);
        s->generation=generation.fetch_add(1,std::memory_order_acq_rel)+1;
        delete pending.exchange(s.release(),std::memory_order_acq_rel);
        fault.store(false); ready.store(true,std::memory_order_release);
    }
    void maintenance() noexcept {
        ResetRequest r;
        while(resets.pop(r)) {
            try {
                if(r.generation==generation.load(std::memory_order_acquire)) {
                    auto replacement=std::make_unique<Session>(r.source->firmware,r.state);
                    replacement->generation=r.generation;
                    // Main-thread firmware changes cannot interleave this operation.
                    delete pending.exchange(replacement.release(),std::memory_order_acq_rel);
                }
            } catch(...) { fault.store(true);ready.store(false);muted.store(true); }
            if(r.source) r.source->resetReferences.fetch_sub(1,std::memory_order_release);
        }
        auto* list=retired.exchange(nullptr,std::memory_order_acq_rel);
        if(!list) { list=heldForReset;heldForReset=nullptr; }
        else { auto* tail=list;while(tail->retiredNext)tail=tail->retiredNext;tail->retiredNext=heldForReset;heldForReset=nullptr; }
        while(list) { auto* next=list->retiredNext;
            if(list->resetReferences.load(std::memory_order_acquire)==0) delete list;
            else { list->retiredNext=heldForReset;heldForReset=list; }
            list=next;
        }
    }
    bool send(Command c) noexcept {
        if(c.op==Op::Panic) {
            muted.store(true,std::memory_order_release);
            panicSerial.fetch_add(1,std::memory_order_acq_rel);
            triggeredTracks.store(0,std::memory_order_relaxed);
            return true;
        }
        c.generation=generation.load(std::memory_order_acquire);
        c.panicSerial=panicSerial.load(std::memory_order_acquire);
        if(commands.push(c)) return true; dropped.fetch_add(1); return false;
    }
    int latencySamples() const noexcept { return latency.load(std::memory_order_acquire); }
    int outputHalfTaps() const noexcept { return bypass?0:toHost.halfTaps(); }
    // DSP compiler calls prepare with the graph stopped; this resets all wrapper
    // audio history, including after sample-rate changes. Engine voices are held.
    void prepare(double rate,int =64) {
        hostRate=std::isfinite(rate)&&rate>=8000&&rate<=384000?rate:44100;
        bypass=std::abs(hostRate-44100)<.01;
        hostMap.set(44100,hostRate); coreMap.set(hostRate,44100); coreCountMap.set(44100,hostRate);
        toHost.design(44100,hostRate); toCore.design(hostRate,44100);
        outScratch.resize(size_t(toHost.numTaps())); inScratch.resize(size_t(toCore.numTaps()));
        for(auto& h:outHistory) h.prepare(8192); for(auto& h:inHistory) h.prepare(8192);
        // A complete 32-frame core block plus the symmetric output filter's
        // lookahead. This INTEGER host-sample delay is actually imposed below.
        // Report the wrapper delay only: the original firmware master path
        // (Engine::kMasterLatency, 18 core frames) remains part of the sound engine.
        latency.store(int(std::ceil((32+(bypass?0:toHost.halfTaps()))*hostRate/44100.)),std::memory_order_release);
        clearPipeline();
    }
    void process(const double* left,const double* right,double* outL,double* outR,int n) noexcept {
        acceptPending();
        if(!active||resetPending.load(std::memory_order_acquire)||fault.load()||acceptedGeneration!=generation.load(std::memory_order_acquire)) {
            std::fill_n(outL,n,0.);std::fill_n(outR,n,0.);return;
        }
        try {
            for(int j=0;j<n;++j) {
                const float il=left?finite(left[j]):0.f,ir=right?finite(right[j]):0.f;
                inHistory[0].push(&il,1);inHistory[1].push(&ir,1);
                const auto wanted=coreCountMap.floorAt(hostFrame+1);
                while(coreTicks<wanted) {
                    // Commands go to the beginning of a core block, never to a
                    // block that has already begun accumulating input samples.
                    if(coreFill==0&&!drain()) { std::fill_n(outL+j,n-j,0.);std::fill_n(outR+j,n-j,0.);return; }
                    float l=il,r=ir;
                    if(!bypass) {
                        auto p=coreMap.at(coreTicks);
                        p.index-=toCore.halfTaps(); // causal input filter
                        const auto* taps=toCore.taps(p,inScratch.data());
                        const auto first=p.index-toCore.halfTaps()+1;
                        l=inHistory[0].dot(first,taps,toCore.numTaps());r=inHistory[1].dot(first,taps,toCore.numTaps());
                    }
                    inputBlock[2*coreFill]=int32_t(finite(l)*8388607.f);inputBlock[2*coreFill+1]=int32_t(finite(r)*8388607.f);
                    ++coreTicks;
                    if(++coreFill==32) { renderBlock();coreFill=0; }
                }
                float l=0,r=0;
                if(bypass) {
                    const float one=1.f;const auto at=hostFrame-latencySamples();
                    l=outHistory[0].dot(at,&one,1);r=outHistory[1].dot(at,&one,1);
                } else {
                    const auto p=hostMap.at(hostFrame-latencySamples());
                    if(p.index+toHost.halfTaps()>=outHistory[0].end()) underruns.fetch_add(1,std::memory_order_relaxed);
                    const auto* taps=toHost.taps(p,outScratch.data());const auto first=p.index-toHost.halfTaps()+1;
                    l=outHistory[0].dot(first,taps,toHost.numTaps());r=outHistory[1].dot(first,taps,toHost.numTaps());
                }
                const bool silence=muted.load(std::memory_order_relaxed) || acceptedGeneration!=generation.load(std::memory_order_acquire) || acceptedPanicSerial!=panicSerial.load(std::memory_order_acquire);
                outL[j]=silence?0.:finite(l);outR[j]=silence?0.:finite(r);++hostFrame;
            }
        } catch(...) { fault.store(true);ready.store(false);muted.store(true);std::fill_n(outL,n,0.);std::fill_n(outR,n,0.); }
    }
};
}
