// crates/hyperclip_ipc/src/system.rs
// GPU detection + NVENC tier lookup — exact copy from electron/services/system.ts

use serde::Serialize;
use std::process::Command;

// ─── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SystemStats {
    pub ram_used: u64,
    pub ram_total: u64,
    pub gpu_usage: u32,
    pub gpu_temp: u32,
    pub gpu_name: String,
    pub gpu_tier: String,
    pub max_workers: u32,
    pub active_workers: u32,
    pub network_ip: String,
    pub is_online: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GPUTier {
    High,
    Mid,
    Low,
    Software,
}

#[derive(Debug, Clone)]
pub struct GPUConfig {
    pub max_sessions: u32,
    pub surface_count: u32,
    pub max_workers: u32,
    pub tier: GPUTier,
    pub label: &'static str,
}

// ─── NVENC_ARCH — EXACT copy from electron/services/system.ts lines 48-89 ──────

fn get_nvenc_arch_config(gpu_name: &str) -> GPUConfig {
    // RTX 50 series (Blackwell)
    if gpu_name.contains("RTX 5080") || gpu_name.contains("RTX 5090") {
        return GPUConfig { max_sessions: 14, surface_count: 64, max_workers: 16, tier: GPUTier::High, label: "RTX 50 series (Blackwell)" };
    }
    // RTX 40 series (Ada Lovelace)
    if gpu_name.contains("RTX 4090") && !gpu_name.contains("D") {
        return GPUConfig { max_sessions: 16, surface_count: 48, max_workers: 14, tier: GPUTier::High, label: "RTX 40 series (Ada Lovelace)" };
    }
    if gpu_name.contains("RTX 4090 D") {
        return GPUConfig { max_sessions: 14, surface_count: 48, max_workers: 12, tier: GPUTier::High, label: "RTX 40 series (Ada Lovelace)" };
    }
    if gpu_name.contains("RTX 4080") {
        return GPUConfig { max_sessions: 16, surface_count: 48, max_workers: 12, tier: GPUTier::High, label: "RTX 40 series (Ada Lovelace)" };
    }
    if gpu_name.contains("RTX 4070 Ti") {
        return GPUConfig { max_sessions: 14, surface_count: 32, max_workers: 10, tier: GPUTier::Mid, label: "RTX 40 series (Ada Lovelace)" };
    }
    if gpu_name.contains("RTX 4070") || gpu_name.contains("RTX 4060 Ti") {
        return GPUConfig { max_sessions: 14, surface_count: 32, max_workers: 8, tier: GPUTier::Mid, label: "RTX 40 series (Ada Lovelace)" };
    }
    // RTX 4050 Laptop
    if gpu_name.contains("RTX 4050") && gpu_name.contains("Laptop") {
        return GPUConfig { max_sessions: 6, surface_count: 16, max_workers: 4, tier: GPUTier::Mid, label: "RTX 40 Laptop (Ada Lovelace)" };
    }
    // RTX 30 series (Ampere)
    if gpu_name.contains("RTX 3090") {
        return GPUConfig { max_sessions: 16, surface_count: 32, max_workers: 12, tier: GPUTier::High, label: "RTX 30 series (Ampere)" };
    }
    if gpu_name.contains("RTX 3080") {
        return GPUConfig { max_sessions: 16, surface_count: 32, max_workers: 10, tier: GPUTier::High, label: "RTX 30 series (Ampere)" };
    }
    if gpu_name.contains("RTX 3070") {
        return GPUConfig { max_sessions: 14, surface_count: 24, max_workers: 6, tier: GPUTier::Mid, label: "RTX 30 series (Ampere)" };
    }
    if gpu_name.contains("RTX 3060 Ti") {
        return GPUConfig { max_sessions: 14, surface_count: 16, max_workers: 6, tier: GPUTier::Mid, label: "RTX 30 series (Ampere)" };
    }
    if gpu_name.contains("RTX 3060") {
        return GPUConfig { max_sessions: 14, surface_count: 16, max_workers: 4, tier: GPUTier::Mid, label: "RTX 30 series (Ampere)" };
    }
    // RTX 20 series (Turing)
    if gpu_name.contains("RTX 2080 Ti") {
        return GPUConfig { max_sessions: 8, surface_count: 16, max_workers: 6, tier: GPUTier::Low, label: "RTX 20 series (Turing)" };
    }
    if gpu_name.contains("RTX 2080") || gpu_name.contains("RTX 2070") {
        return GPUConfig { max_sessions: 8, surface_count: 16, max_workers: 4, tier: GPUTier::Low, label: "RTX 20 series (Turing)" };
    }
    if gpu_name.contains("RTX 2060") {
        return GPUConfig { max_sessions: 6, surface_count: 16, max_workers: 3, tier: GPUTier::Low, label: "RTX 20 series (Turing)" };
    }
    // GTX 16 series
    if gpu_name.contains("GTX 1660") {
        return GPUConfig { max_sessions: 4, surface_count: 8, max_workers: 2, tier: GPUTier::Low, label: "GTX 16 series (Turing)" };
    }
    // Generic RTX fallback
    if gpu_name.contains("RTX") {
        return GPUConfig { max_sessions: 8, surface_count: 16, max_workers: 6, tier: GPUTier::Mid, label: "Unknown RTX" };
    }
    // No GPU
    GPUConfig { max_sessions: 2, surface_count: 8, max_workers: 2, tier: GPUTier::Software, label: "Software encoding" }
}

fn tier_to_string(tier: GPUTier) -> &'static str {
    match tier {
        GPUTier::High => "high",
        GPUTier::Mid => "mid",
        GPUTier::Low => "low",
        GPUTier::Software => "software",
    }
}

// ─── Module-level GPU cache ─────────────────────────────────────────────────────

static mut _CACHED_GPU: Option<(String, GPUConfig)> = None;

fn cached_gpu() -> (String, GPUConfig) {
    // SAFETY: called from single-threaded main loop at startup; no data races.
    // This is acceptable because GPU detection must run once and the backend is single-threaded.
    unsafe {
        if let Some(ref cached) = _CACHED_GPU {
            return cached.clone();
        }
        let (name, config) = detect_gpu();
        _CACHED_GPU = Some((name.clone(), config.clone()));
        (name, config)
    }
}

// ─── GPU detection ─────────────────────────────────────────────────────────────

fn detect_gpu() -> (String, GPUConfig) {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let gpu_name = s.split('\n').next().unwrap_or("Unknown GPU").split(',').next().unwrap_or("Unknown GPU").trim().to_string();
            let config = get_nvenc_arch_config(&gpu_name);
            tracing::info!(
                "[GPU] Found: {} ({}MB) → {} sessions={} workers={}",
                gpu_name,
                s.split(',').nth(1).unwrap_or("0").trim(),
                config.label,
                config.max_sessions,
                config.max_workers
            );
            (gpu_name, config)
        }
        _ => {
            tracing::info!("[GPU] No NVIDIA GPU found — using software encoding");
            ("CPU".to_string(), GPUConfig { max_sessions: 2, surface_count: 8, max_workers: 2, tier: GPUTier::Software, label: "Software encoding" })
        }
    }
}

// ─── Public API ─────────────────────────────────────────────────────────────────

pub fn get_system_stats() -> SystemStats {
    let (gpu_name, gpu_config) = cached_gpu();
    SystemStats {
        gpu_name,
        gpu_tier: tier_to_string(gpu_config.tier).to_string(),
        max_workers: gpu_config.max_workers,
        active_workers: 0,
        gpu_usage: 0,
        gpu_temp: 0,
        ram_used: 0,
        ram_total: 0,
        network_ip: "127.0.0.1".to_string(),
        is_online: true,
    }
}

pub fn get_gpu_config() -> GPUConfig {
    cached_gpu().1
}
