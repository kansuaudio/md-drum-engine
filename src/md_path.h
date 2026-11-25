// Translate Max volume paths to the native paths required by the firmware reader.
#pragma once
#include "ext.h"
#include "ext_path.h"
#include <array>
#include <cctype>
#include <stdexcept>
#include <string>

namespace mdmax {
// A drive-letter (C:\ or C:/) or UNC (\\server\share) path on Windows.
inline bool isWindowsAbsolute(const std::string& path) {
    if(path.size()>=3 && std::isalpha(static_cast<unsigned char>(path[0])) && path[1]==':' && (path[2]=='\\'||path[2]=='/')) return true;
    return path.size()>=2 && (path[0]=='\\'||path[0]=='/') && (path[1]=='\\'||path[1]=='/');
}
inline bool isNativeAbsolute(const std::string& path) {
#ifdef WIN_VERSION
    return isWindowsAbsolute(path);
#else
    return !path.empty() && path.front()=='/';
#endif
}
inline std::string resolveFirmwarePath(const char* input) {
    const std::string path=input?input:"";
    if(path.empty())throw std::runtime_error("No OS file selected");
    // Existing presets and native paths (POSIX on macOS, C:/... on Windows)
    // already name their correct filesystem volume.
    if(isNativeAbsolute(path))return path;
    const auto volumeSeparator=path.find(":/");
    if(volumeSeparator==std::string::npos || volumeSeparator==0)
        throw std::runtime_error("OS file path is not absolute; select the .syx file again");
    if(path.size()>=MAX_PATH_CHARS)
        throw std::runtime_error("OS file path is too long for Max; move the .syx file to a shorter path");
    short pathId=0;
    std::array<char,MAX_PATH_CHARS> filename{},native{};
    const auto parseError=path_frompathname(path.c_str(),&pathId,filename.data());
    if(parseError)
        throw std::runtime_error("Cannot resolve OS file volume or folder (Max error "+std::to_string(parseError)+"): "+path);
    const auto nativeError=path_toabsolutesystempath(pathId,filename.data(),native.data());
    if(nativeError || !isNativeAbsolute(native.data()))
        throw std::runtime_error("Cannot convert OS file path to a system path (Max error "+std::to_string(nativeError)+"): "+path);
    return std::string(native.data());
}
}
