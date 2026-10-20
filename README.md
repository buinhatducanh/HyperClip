# HyperClip WebSub Relay

Server giữ callback công khai của hub PubSubHubbub (YouTube) và đẩy chuông về
desktop app qua SSE. Dựng lại 28/08 sau sự cố relay cũ chết origin (Cloudflare
530) — wire format khớp đúng client trong `hyperclip-tauri.exe` (0e743c3):

- `POST /subscribe` body `{"channels":["UC…",…]}` → `{"ok":true,"added":N,"total":M}`
- `GET /events` — SSE, mỗi chuông: `data: {"kind":"new-video","channelId":"UC…","videoId":"…","title":"…","publishedAtMs":…,"receivedAtMs":…}`
- `GET|POST /callback` — hub verify + notify (nội bộ, hub gọi)
- `GET /health` — `{ok, channels, leased, clients, uptimeSec}`

## Chạy

```bash
# Node >= 18, không dependency
PUBLIC_URL=https://relay.hyperclip.id.vn \
TOKEN=<websubRelayToken của app, bỏ trống nếu không dùng> \
node relay.js
# mặc định nghe :8787 — đổi bằng PORT=…
```

State (danh sách kênh + lease hub) tự ghi vào `relay-state.json` cạnh file.
Khởi động lại là tự đăng ký lại mọi kênh hết lease; app cũng re-sync danh sách
kênh mỗi lần nối lại nên không mất gì khi đổi máy/mất state.

## Deploy sau Cloudflare

Lỗi hôm 28/08 (HTTP 530) = bản ghi DNS `relay.hyperclip.id.vn` trỏ về origin
đã chết (thường là cloudflared tunnel tắt). Hai cách dựng:

**Cloudflared tunnel (khuyến nghị — không cần mở port):**

```bash
cloudflared tunnel create hyperclip-relay
cloudflared tunnel route dns hyperclip-relay relay.hyperclip.id.vn
# config.yml:
#   tunnel: <TUNNEL_ID>
#   credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
#   ingress:
#     - hostname: relay.hyperclip.id.vn
#       service: http://localhost:8787
#     - service: http_status:404
cloudflared tunnel run hyperclip-relay
```

**Hoặc VPS + DNS proxied:** trỏ A record về VPS, chạy relay sau nginx/caddy.
SSE qua Cloudflare ổn (relay tự ping mỗi 25s nên không dính idle timeout).

## systemd

`hyperclip-relay.service` kèm sẵn — sửa đường dẫn + env rồi:

```bash
cp hyperclip-relay.service /etc/systemd/system/
systemctl enable --now hyperclip-relay
```

## Kiểm tra sống

```bash
curl -s https://relay.hyperclip.id.vn/health
# {"ok":true,"channels":53,...} — app nối vào là log hiện:
# [WebSub] Đồng bộ 52 kênh với relay: {"ok":true,...}
# [WebSub] Nối SSE https://relay.hyperclip.id.vn — chuông đẩy đang sống
```

Chuông thật đầu tiên sẽ hiện `[bell] UC… <videoId> … (+X.Xs sau publish)` ở
relay và `src=websub` trong `[Detect]` của app.
