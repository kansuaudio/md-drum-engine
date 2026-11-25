// Audio regression for the actual firmware sends and master return controls.
#include "md_processor.h"
#include <iostream>
#include <vector>
#include <cmath>
#include <algorithm>
#include <stdexcept>
using namespace mdmax;
using Audio=std::vector<double>;
static void require(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
static Audio render(Processor& p,int frames){
    Audio out;out.reserve(size_t(frames)*2);double l[64]{},r[64]{};
    for(int at=0;at<frames;at+=64){int n=std::min(64,frames-at);p.process(nullptr,nullptr,l,r,n);for(int i=0;i<n;++i){require(std::isfinite(l[i])&&std::isfinite(r[i]),"non-finite output");out.push_back(l[i]);out.push_back(r[i]);}}
    require(!p.fault.load(),"DSP fault");return out;
}
static double difference(const Audio& a,const Audio& b,size_t start=0){double sum=0;for(size_t i=start;i<a.size();++i)sum+=std::abs(a[i]-b[i]);return sum/double(a.size()-start);}
static double rms(const Audio& a,size_t start=0){double sum=0;for(size_t i=start;i<a.size();++i)sum+=a[i]*a[i];return std::sqrt(sum/double(a.size()-start));}
static Audio fixture(const std::string& path,int sendParam=-1,int masterGroup=-1,int masterParam=-1,int value=0){
    Processor p;p.prepare(44100,64);p.stage(std::make_unique<Session>(path));
    p.send({Op::Machine,0,20});p.send({Op::Param,0,1,20});
    if(sendParam>=0)p.send({Op::Param,0,sendParam,100});
    if(masterGroup>=0)p.send({Op::Master,masterGroup,masterParam,value});
    render(p,4096); // let the firmware's parameter slew settle before the hit
    p.send({Op::Trigger,0,110});return render(p,44100*3);
}
int main(int argc,char** argv){
    if(argc!=2){std::cerr<<"fx-regression firmware.syx\n";return 2;}
    std::cout.setf(std::ios::unitbuf);
    try{
        const std::string path=argv[1];auto dry=fixture(path);
        require(rms(dry)>1e-5,"dry fixture silent");
        auto delay=fixture(path,19),reverb=fixture(path,20);
        auto noDelayReturn=fixture(path,19,1,7,0),noReverbReturn=fixture(path,20,0,7,0);
        auto delayTime=fixture(path,19,1,0,48),reverbDecay=fixture(path,20,0,2,100);
        auto dryDelayEdit=fixture(path,-1,1,0,48),dryReverbEdit=fixture(path,-1,0,2,100);
        const double delayDiff=difference(dry,delay),reverbDiff=difference(dry,reverb);
        std::cout<<"dry_rms="<<rms(dry)<<"\n";
        std::cout<<"delay_send_difference="<<delayDiff<<" reverb_send_difference="<<reverbDiff<<"\n";
        std::cout<<"delay_tail_difference="<<difference(dry,delay,44100)<<" reverb_tail_difference="<<difference(dry,reverb,44100)<<"\n";
        std::cout<<"delay_return_zero_difference="<<difference(dry,noDelayReturn)<<" reverb_return_zero_difference="<<difference(dry,noReverbReturn)<<"\n";
        std::cout<<"delay_time_difference="<<difference(delay,delayTime)<<" reverb_decay_difference="<<difference(reverb,reverbDecay)<<"\n";
        std::cout<<"zero_send_delay_edit_difference="<<difference(dry,dryDelayEdit)<<" zero_send_reverb_edit_difference="<<difference(dry,dryReverbEdit)<<"\n";
        require(delayDiff>1e-5,"DEL send produces no audible effect");require(reverbDiff>1e-5,"REV send produces no audible effect");
        require(difference(dry,noDelayReturn)<1e-8,"delay LEV=0 does not remove its return");require(difference(dry,noReverbReturn)<1e-8,"reverb LEV=0 does not remove its return");
        require(difference(delay,delayTime)>1e-5,"Echo TIME has no effect with DEL send");require(difference(reverb,reverbDecay)>1e-5,"Reverb DEC has no effect with REV send");
        require(dry==dryDelayEdit&&dry==dryReverbEdit,"master send effects changed a track with both sends zero");
        std::cout<<"PASS: both sends audible; return LEV gates wet signal; Echo TIME and Reverb DEC affect audio; zero sends stay dry\n";return 0;
    }catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}
}
