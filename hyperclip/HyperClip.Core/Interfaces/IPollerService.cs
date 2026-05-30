using HyperClip.Core.Models;

namespace HyperClip.Core.Interfaces;

public interface IPollerService
{
    event EventHandler<DetectedVideo>? OnVideoDetected;
    PollerStatus GetStatus();
    void Start(int intervalMs = 5000);
    void Stop();
    void Pause();
    void Resume();
    bool IsActive { get; }
}
