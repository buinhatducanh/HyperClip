use hyperclip_ipc::error::HyperclipError;

#[test]
fn test_error_display() {
    let err = HyperclipError::ChromeCookieLocked;
    assert_eq!(err.to_string(), "Chrome cookie DB locked (Chrome đang mở). Close Chrome and retry.");
}

#[test]
fn test_error_video_unavailable() {
    let err = HyperclipError::VideoUnavailable("private".into());
    assert!(err.to_string().contains("private"));
}