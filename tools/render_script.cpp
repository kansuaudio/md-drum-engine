// Offline render of a command script through the real engine (no Max/Live).
// Script lines: "tempo <bpm>", "machine <t> <id>", "param <t> <k> <v>",
// "lfo <t> <k> <v>", "master <g> <k> <v>", "note <sample> <t> <vel>",
// "length <samples>". tools/render_kit.py writes these from .mdkit + .mid.
#include "md_processor.h"
#include "util/Wav.h"
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iostream>
#include <sstream>
#include <vector>
using namespace mdmax;
struct Note { long long at; int track, velocity; };
int main(int argc,char** argv){
    if(argc!=4){std::cerr<<"render-script firmware.syx script.txt out.wav\n";return 2;}
    try{
        Processor p;p.prepare(44100,64);p.stage(std::make_unique<Session>(argv[1]));
        std::ifstream in(argv[2]);std::string line;std::vector<Note> notes;long long length=44100*8;
        while(std::getline(in,line)){
            std::istringstream s(line);std::string op;s>>op;
            if(op=="tempo"){double b;s>>b;p.send({Op::Tempo,0,0,0,b});}
            else if(op=="machine"){int t,id;s>>t>>id;p.send({Op::Machine,t,id});}
            else if(op=="param"){int t,k,v;s>>t>>k>>v;p.send({Op::Param,t,k,v});}
            else if(op=="lfo"){int t,k,v;s>>t>>k>>v;p.send({Op::Lfo,t,k,v});}
            else if(op=="master"){int g,k,v;s>>g>>k>>v;p.send({Op::Master,g,k,v});}
            else if(op=="note"){Note n;s>>n.at>>n.track>>n.velocity;notes.push_back(n);}
            else if(op=="length"){s>>length;}
        }
        std::sort(notes.begin(),notes.end(),[](const Note& a,const Note& b){return a.at<b.at;});
        double l[64],r[64];std::vector<double> warm(4096*2);
        for(int i=0;i<4096;i+=64)p.process(nullptr,nullptr,l,r,64); // parameter slew settles before bar 1
        std::vector<int32_t> pcm;pcm.reserve(size_t(length)*2);double peak=0,sum=0;size_t ni=0;
        for(long long at=0;at<length;){
            while(ni<notes.size()&&notes[ni].at<=at){p.send({Op::Trigger,notes[ni].track,notes[ni].velocity});++ni;}
            long long next=ni<notes.size()?notes[ni].at:length;int n=int(std::min<long long>({64,next-at,length-at}));if(n<=0)n=1;
            p.process(nullptr,nullptr,l,r,n);
            for(int i=0;i<n;++i){peak=std::max({peak,std::abs(l[i]),std::abs(r[i])});sum+=l[i]*l[i]+r[i]*r[i];pcm.push_back(int32_t(l[i]*8388607));pcm.push_back(int32_t(r[i]*8388607));}
            at+=n;
        }
        if(p.fault.load())throw std::runtime_error("DSP fault");
        if(!mnm::util::writeWav24(argv[3],pcm,2,44100))throw std::runtime_error("WAV write failed");
        std::cout<<"peak="<<peak<<" rms="<<std::sqrt(sum/double(pcm.size()))<<" notes="<<notes.size()<<"\n";
        return 0;
    }catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}
}
