use hyperclip_ipc::cookies_dpapi::{is_encrypted_v10};

#[test]
fn test_is_encrypted_v10_with_data() {
    assert!(is_encrypted_v10(&[1, 2, 3]));
}

#[test]
fn test_is_encrypted_v10_empty() {
    assert!(!is_encrypted_v10(&[]));
}

#[test]
fn test_decrypt_empty_returns_ok() {
    use hyperclip_ipc::cookies_dpapi::decrypt_chrome_v10;
    let result = decrypt_chrome_v10(&[]);
    assert!(result.is_ok());
    assert_eq!(result.unwrap(), Vec::<u8>::new());
}