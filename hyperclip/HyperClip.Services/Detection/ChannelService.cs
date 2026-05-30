using HyperClip.Core.Interfaces;
using HyperClip.Core.Models;

namespace HyperClip.Services.Detection;

public class ChannelService : IChannelService
{
    private readonly IChannelStore _channelStore;
    private readonly RssFeedScanner _feedScanner;

    public ChannelService(IChannelStore channelStore, RssFeedScanner feedScanner)
    {
        _channelStore = channelStore;
        _feedScanner = feedScanner;
    }

    public async Task<Channel?> AddChannelAsync(string urlOrHandle, CancellationToken ct = default)
    {
        try
        {
            var info = await _feedScanner.GetChannelInfoAsync(urlOrHandle, ct);
            if (info == null) return null;

            var channel = new Channel
            {
                Id = Guid.NewGuid().ToString("N")[..12],
                Name = info.ChannelName,
                Handle = urlOrHandle,
                ChannelId = info.ChannelId,
                AvatarColor = $"#{GetHashCodeForName(info.ChannelName):X6}",
            };
            await _channelStore.SaveAsync(channel, ct);
            return channel;
        }
        catch
        {
            return null;
        }
    }

    public Task PauseChannelAsync(string channelId, CancellationToken ct = default)
        => _channelStore.PauseAsync(channelId, ct);

    public Task ResumeChannelAsync(string channelId, CancellationToken ct = default)
        => _channelStore.ResumeAsync(channelId, ct);

    public Task SyncChannelAsync(string channelId, CancellationToken ct = default)
    {
        // Trigger re-scan — the poller will pick it up on next cycle
        return Task.CompletedTask;
    }

    private static int GetHashCodeForName(string name)
    {
        return (name.GetHashCode() & 0x7FFFFFFF) % 0xFFFFFF;
    }
}
