using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public interface IChannelService
{
    Task<Channel?> AddChannelAsync(string urlOrHandle, CancellationToken ct = default);
    Task PauseChannelAsync(string channelId, CancellationToken ct = default);
    Task ResumeChannelAsync(string channelId, CancellationToken ct = default);
    Task SyncChannelAsync(string channelId, CancellationToken ct = default);
}
