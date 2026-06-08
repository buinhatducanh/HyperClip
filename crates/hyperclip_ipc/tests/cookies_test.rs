use hyperclip_ipc::cookies::{CookieExtractionResult, ExtractedCookie};

fn make_result() -> CookieExtractionResult {
    CookieExtractionResult {
        cookies: vec![
            ExtractedCookie {
                name: "SAPISID".into(),
                value: "test_sapisid".into(),
                domain: ".youtube.com".into(),
            },
            ExtractedCookie {
                name: "__Secure-1PSID".into(),
                value: "test_psid".into(),
                domain: ".youtube.com".into(),
            },
        ],
        profile_name: "Default".into(),
        domain: "youtube.com".into(),
        socs_value: None,
    }
}

#[test]
fn test_build_cookie_string_contains_required_keys() {
    let result = make_result();
    let s = result.build_cookie_string();
    assert!(s.contains("SAPISID=test_sapisid"));
    assert!(s.contains("__Secure-1PSID=test_psid"));
}

#[test]
fn test_build_cookie_string_injects_socs_cai() {
    let result = make_result();
    let s = result.build_cookie_string();
    assert!(s.contains("SOCS=CAI"), "should inject SOCS=CAI: {}", s);
}

#[test]
fn test_build_cookie_string_no_duplicate_socs() {
    let mut result = make_result();
    result.cookies.push(ExtractedCookie {
        name: "SOCS".into(),
        value: "OLD_VALUE".into(),
        domain: ".youtube.com".into(),
    });
    result.socs_value = Some("CAI".into());
    let s = result.build_cookie_string();
    assert!(s.contains("SOCS=CAI"));
    assert!(!s.contains("SOCS=OLD_VALUE"));
}

#[test]
fn test_serialize_result() {
    let result = make_result();
    let json = serde_json::to_string(&result).unwrap();
    assert!(json.contains("\"profile_name\":\"Default\""));
    assert!(json.contains("\"SAPISID\""));
}
