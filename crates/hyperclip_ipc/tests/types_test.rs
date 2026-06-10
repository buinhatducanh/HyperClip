use hyperclip_ipc::WorkspaceStatus;
use serde_json;

#[test]
fn test_workspace_status_serialization() {
    let status = WorkspaceStatus::Rendering;
    let json = serde_json::to_string(&status).unwrap();
    assert_eq!(json, "\"rendering\"");
}

#[test]
fn test_workspace_status_deserialization() {
    let json = "\"downloading\"";
    let status: WorkspaceStatus = serde_json::from_str(json).unwrap();
    assert_eq!(status, WorkspaceStatus::Downloading);
}

#[test]
fn test_workspace_status_all_variants() {
    let variants = vec![
        (WorkspaceStatus::New, "\"new\""),
        (WorkspaceStatus::Waiting, "\"waiting\""),
        (WorkspaceStatus::Downloading, "\"downloading\""),
        (WorkspaceStatus::Ready, "\"ready\""),
        (WorkspaceStatus::Rendering, "\"rendering\""),
        (WorkspaceStatus::Done, "\"done\""),
        (WorkspaceStatus::Error, "\"error\""),
    ];
    for (status, expected) in variants {
        assert_eq!(serde_json::to_string(&status).unwrap(), expected);
    }
}