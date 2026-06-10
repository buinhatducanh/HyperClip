export const meta = {
  title: "Fix detection pipeline gaps",
  description: "Fix the 10 gaps in video detection pipeline for HyperClip Rust stack - parallel execution"
};

// Agent 1: Fix poller.rs core engine
agent("fix-poller-core", {
  description: "Rewrite poller.rs with concurrent scanning, filters, early termination, event emission",
  prompt: `Read D:\\LOOP_COMPANY\\HyperClip\\crates\\hyperclip_ipc\\src\\poller.rs

Write the COMPLETE new file to D:\\LOOP_COMPANY\\HyperClip\\crates\\hyperclip_ipc\\src\\poller.rs with these changes:

1. Add NewVideoEvent struct with: channel_id, channel_name, video_id, title, thumbnail_url, published_at, duration_sec, detected_at
2. Add process_fn: Arc<dyn Fn(NewVideoEvent) + Send + Sync> field to Poller struct
3. Use tokio::Sync::Semaphore for 5 concurrent channels scanning
4. Add duration filter (skip < 60s short videos)
5. Add aspect ratio filter (width/height < 0.6 is vertical - skip)
6. Add early termination after 5 new videos per poll
7. Add load_seen_ids() and seen_ids_snapshot() methods
8. Add update_channels() method for live channel sync
9. Emit NewVideoEvent via process_fn for each new video found

Keep the existing tests unchanged. Use only crates already in Cargo.toml.`
})

// Agent 2: Fix innertube_helper.js multi-strategy extraction
agent("fix-innertube-helper", {
  description: "Add multi-strategy extraction fallback to innertube_helper.js",
  prompt: `Read D:\\LOOP_COMPANY\\HyperClip\\crates\\hyperclip_ipc\\src\\innertube_helper.js

Write the COMPLETE new file with:

1. Multi-strategy extraction in order:
   - getChannel -> getVideos (primary, as before)
   - If primary returns < 2 videos: try browse /videos tab
   - If still < 2: try channel search
   - If still empty: RSS feed fetch (parse /feeds/videos.xml)

2. LockupView timestamp handling via extractPublishedAt():
   - Strategy 1: direct v.published.timestamp
   - Strategy 2: v.published_time_text regex parse
   - Strategy 3: lockupMetadata.metadata.metadata_parts deep scan
   - Strategy 4: JSON.stringify full object regex scan for "N minute/hour/day" pattern

3. Helper extractDuration(), extractThumbnail(), normalizeVideo()

4. RSS strategy via fetch() parsing XML for video IDs, titles, published times

Keep JSON-RPC protocol same: stdin requests -> stdout responses.
Keep the same response format: { id, ok, videos: [{ videoId, title, publishedAt, thumbnailUrl, durationSec }] }`
})

// Agent 3: Fix store.rs - add SeenIdsStore persistence
agent("fix-store", {
  description: "Add seen_ids persistence to store.rs",
  prompt: `Read D:\\LOOP_COMPANY\\HyperClip\\crates\\hyperclip_ipc\\src\\store.rs

Add at the end of the file using Edit tool:

1. A SeenIdsStore struct with: ids (Vec<String>), updated_at (i64)
2. Implement load() and save() methods
3. Implement Default
4. Add get_seen_ids_path() function returning APPDATA/HyperClip/seen_ids.json

Then update D:\\LOOP_COMPANY\\HyperClip\\crates\\hyperclip_ipc\\src\\lib.rs to export them (use Edit tool).`
})

// Agent 4: Fix client.py event dispatch
agent("fix-client-py", {
  description: "Add new_video_detected event handler to client.py",
  prompt: `Read D:\\LOOP_COMPANY\\HyperClip\\src\\backend\\client.py

In the _dispatch_event method (around line 134-156), there is currently a bug: new_video_detected is emitted inside the download:progress-event handler.

Fix by adding a proper elif clause for "new_video_detected" method.

Old code around line 142-144:
elif method == "notification":
    bus.notification.emit(params.get("title", ""), params.get("message", ""))
elif method == "download:progress-event":

New code:
elif method == "notification":
    bus.notification.emit(params.get("title", ""), params.get("message", ""))
elif method == "new_video_detected":
    bus.new_video_detected.emit(params)
elif method == "download:progress-event":

Use the Edit tool.`
})
