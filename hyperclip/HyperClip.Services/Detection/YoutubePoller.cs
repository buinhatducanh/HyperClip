using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Detection;

public class YoutubePoller : IPollerService, IDisposable
{
    private readonly RssFeedScanner _scanner;
    private readonly IChannelStore _channelStore;
    private readonly HashSet<string> _seenVideoIds = new();
    private Timer? _timer;
    private readonly Random _rng = new();
    private int _pollIntervalMs = 5000;
    private int _videoCount;
    private int _newVideoCount;
    private long? _lastPollAt;
    private long? _lastNewVideosAt;
    private string? _lastError;
    private bool _disposed;

    public event EventHandler<DetectedVideo>? OnVideoDetected;

    public bool IsActive => _timer != null;

    public YoutubePoller(RssFeedScanner scanner, IChannelStore channelStore)
    {
        _scanner = scanner;
        _channelStore = channelStore;
    }

    public void Start(int intervalMs = 5000)
    {
        _pollIntervalMs = intervalMs;
        _timer = new Timer(async _ => await PollOnceAsync(), null, 0, Timeout.Infinite);
    }

    public void Stop()
    {
        _timer?.Dispose();
        _timer = null;
    }

    public PollerStatus GetStatus() => new()
    {
        Active = IsActive,
        PollIntervalMs = _pollIntervalMs,
        LastPollAt = _lastPollAt,
        LastNewVideosAt = _lastNewVideosAt,
        ChannelCount = _channelStore.GetAllAsync().GetAwaiter().GetResult().Length,
        VideoCount = _videoCount,
        NewVideoCount = _newVideoCount,
        LastError = _lastError,
    };

    private async Task PollOnceAsync()
    {
        if (_disposed) return;

        try
        {
            _lastPollAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var channels = await _channelStore.GetAllAsync();
            var channelCount = 0;

            foreach (var channel in channels)
            {
                if (string.IsNullOrEmpty(channel.ChannelId) || !channel.ChannelId.StartsWith("UC")) continue;
                if (channel.Paused) continue;

                channelCount++;

                var videos = await _scanner.FetchLatestVideosAsync(channel.ChannelId, 5);

                foreach (var video in videos)
                {
                    _videoCount++;
                    if (_seenVideoIds.Contains(video.VideoId)) continue;

                    _seenVideoIds.Add(video.VideoId);
                    _newVideoCount++;
                    _lastNewVideosAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                    video.ChannelId = channel.ChannelId;
                    video.ChannelName = channel.Name;

                    OnVideoDetected?.Invoke(this, video);
                }
            }

            _lastError = null;
        }
        catch (Exception ex)
        {
            _lastError = ex.Message;
        }
        finally
        {
            if (!_disposed)
            {
                var jitter = _pollIntervalMs * 0.2;
                var delay = _pollIntervalMs + (int)((_rng.NextDouble() * 2 - 1) * jitter);
                _timer?.Change(Math.Max(1000, delay), Timeout.Infinite);
            }
        }
    }

    public void Dispose()
    {
        _disposed = true;
        _timer?.Dispose();
    }
}
