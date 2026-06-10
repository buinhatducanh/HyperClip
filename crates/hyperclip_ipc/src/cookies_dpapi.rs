//! Chrome cookie decryption using Windows DPAPI.
//!
//! Chrome 80+ (v11 cookies): encrypted_value is empty in DB, value column is plaintext.
//! Chrome <80 (v10 cookies): encrypted_value contains DPAPI-encrypted blob.

use crate::error::{HyperclipError, Result};

/// Win32 CRYPT_DATA_BLOB structure (layout match).
#[repr(C)]
#[derive(Default)]
struct CryptBlob {
    cb_data: u32,
    pb_data: *mut u8,
}

#[link(name = "crypt32")]
extern "system" {
    fn CryptUnprotectData(
        p_data_in: *const CryptBlob,
        ppsz_data_descr: *mut *mut u16,
        p_optional_entropy: *const CryptBlob,
        pv_reserved: *mut std::ffi::c_void,
        p_prompt_struct: *mut std::ffi::c_void,
        dw_flags: u32,
        p_data_out: *mut CryptBlob,
    ) -> i32;
}

/// Decrypt Chrome v10 cookie (DPAPI-encrypted).
/// If input is plaintext (v11), returns as-is.
#[cfg(target_os = "windows")]
pub fn decrypt_chrome_v10(encrypted: &[u8]) -> Result<Vec<u8>> {
    if encrypted.is_empty() {
        return Ok(Vec::new());
    }

    unsafe {
        let input = CryptBlob {
            cb_data: encrypted.len() as u32,
            pb_data: encrypted.as_ptr() as *mut u8,
        };
        let mut output = CryptBlob::default();

        let result = CryptUnprotectData(
            &input as *const CryptBlob,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut output as *mut CryptBlob,
        );

        if result == 0 {
            return Err(HyperclipError::DatabaseCorruption(
                format!("DPAPI decryption failed")
            ));
        }

        let plaintext = std::slice::from_raw_parts(
            output.pb_data as *const u8,
            output.cb_data as usize,
        ).to_vec();

        Ok(plaintext)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn decrypt_chrome_v10(encrypted: &[u8]) -> Result<Vec<u8>> {
    // Non-Windows: cookies are plaintext (Linux/macOS)
    Ok(encrypted.to_vec())
}

/// Detect cookie version based on `encrypted_value` field.
/// v10: encrypted_value contains DPAPI blob (non-empty)
/// v11: encrypted_value is empty, value is plaintext in the column
pub fn is_encrypted_v10(encrypted_value: &[u8]) -> bool {
    !encrypted_value.is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_encrypted_v10_with_data() {
        assert!(is_encrypted_v10(&[1, 2, 3]));
    }

    #[test]
    fn test_is_encrypted_v10_empty() {
        assert!(!is_encrypted_v10(&[]));
    }
}