// src/ui/qml/ChannelDir.js
// Thư viện Singleton chia sẻ danh mục Kênh YouTube (tra cứu Avatar, Màu sắc, ID, Name)
.pragma library

var _cache = {};
var _isLoaded = false;

function register(ch) {
    if (!ch) return;
    var entry = {
        id: ch.id || "",
        channelId: ch.channelId || "",
        name: ch.name || "",
        handle: ch.handle || "",
        avatarUrl: ch.avatarUrl || "",
        avatarColor: ch.avatarColor || ""
    };
    if (entry.id) {
        _cache[entry.id] = entry;
        _cache[entry.id.toLowerCase()] = entry;
    }
    if (entry.channelId) {
        _cache[entry.channelId] = entry;
        _cache[entry.channelId.toLowerCase()] = entry;
    }
    if (entry.name) {
        _cache[entry.name] = entry;
        _cache[entry.name.toLowerCase()] = entry;
    }
    if (entry.handle) {
        _cache[entry.handle] = entry;
        _cache[entry.handle.toLowerCase()] = entry;
    }
}

function feedList(list) {
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
        register(list[i]);
    }
    _isLoaded = true;
}

function ensureLoaded(channelListModel, tiktokModel, backend) {
    if (_isLoaded && Object.keys(_cache).length > 0) return;

    // 1. Thử nạp từ channelListModel
    try {
        if (typeof channelListModel !== "undefined" && channelListModel) {
            var cnt = (typeof channelListModel.count === "number") ? channelListModel.count :
                ((typeof channelListModel.rowCount === "function") ? channelListModel.rowCount() : 0);
            if (cnt > 0) {
                for (var i = 0; i < cnt; i++) {
                    var item = channelListModel.get ? channelListModel.get(i) : null;
                    if (item) register(item);
                }
                _isLoaded = true;
            }
        }
    } catch (e1) { }

    // 2. Thử nạp từ tiktokModel.channels
    try {
        if (typeof tiktokModel !== "undefined" && tiktokModel && tiktokModel.channels) {
            feedList(tiktokModel.channels);
        }
    } catch (e2) { }

    // 3. Fallback đọc trực tiếp từ backend channel:list nếu cache chưa có
        if (!_isLoaded && typeof backend !== "undefined" && backend && typeof backend.send_command === "function") {
            try {
                var resp = backend.send_command("channel:list");
                if (resp) {
                    var r = resp.result || resp;
                    var list = (r && r.channels) ? r.channels : (Array.isArray(r) ? r : []);
                    if (list.length > 0) {
                        feedList(list);
                    }
                }
            } catch (e3) { }
        }
    }

    function lookup(key, channelListModel, tiktokModel, backend) {
        if (!key) return null;
        var k = String(key).trim();
        if (_cache[k]) return _cache[k];
        var kLower = k.toLowerCase();
        if (_cache[kLower]) return _cache[kLower];

        // Nếu chưa thấy, thử load lại
        ensureLoaded(channelListModel, tiktokModel, backend);
        if (_cache[k]) return _cache[k];
        if (_cache[kLower]) return _cache[kLower];

        return null;
    }

