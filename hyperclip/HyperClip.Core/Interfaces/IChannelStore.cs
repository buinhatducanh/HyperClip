using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public interface IChannelStore
{
    Task<Channel[]> GetAllAsync(CancellationToken ct = default);
    Task<Channel?> GetByIdAsync(string id, CancellationToken ct = default);
    Task SaveAsync(Channel channel, CancellationToken ct = default);
    Task DeleteAsync(string id, CancellationToken ct = default);
    Task PauseAsync(string id, CancellationToken ct = default);
    Task ResumeAsync(string id, CancellationToken ct = default);
    event EventHandler<Channel>? ChannelUpdated;
}
