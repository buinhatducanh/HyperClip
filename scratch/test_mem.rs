// scratch/test_mem.rs
use std::process::Command;

#[cfg(target_os = "windows")]
#[repr(C)]
#[allow(non_snake_case)]
struct MEMORYSTATUSEX {
    dwLength: u32,
    dwMemoryLoad: u32,
    ullTotalPhys: u64,
    ullAvailPhys: u64,
    ullTotalPageFile: u64,
    ullAvailPageFile: u64,
    ullTotalVirtual: u64,
    ullAvailVirtual: u64,
    ullAvailExtendedPhys: u64,
}

#[cfg(target_os = "windows")]
extern "system" {
    fn GlobalMemoryStatusEx(lpBuffer: *mut MEMORYSTATUSEX) -> i32;
}

fn main() {
    #[cfg(target_os = "windows")]
    {
        let mut mem_info = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            dwMemoryLoad: 0,
            ullTotalPhys: 0,
            ullAvailPhys: 0,
            ullTotalPageFile: 0,
            ullAvailPageFile: 0,
            ullTotalVirtual: 0,
            ullAvailVirtual: 0,
            ullAvailExtendedPhys: 0,
        };
        unsafe {
            let res = GlobalMemoryStatusEx(&mut mem_info);
            println!("GlobalMemoryStatusEx result: {}", res);
            println!("dwLength: {}", mem_info.dwLength);
            println!("ullTotalPhys: {}", mem_info.ullTotalPhys);
            println!("ullAvailPhys: {}", mem_info.ullAvailPhys);
        }
    }
}
