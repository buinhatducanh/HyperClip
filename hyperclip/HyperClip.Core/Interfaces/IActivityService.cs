namespace HyperClip.Core.Interfaces;

public interface IActivityService
{
    void AddEntry(string message, string type = "info");
    void Clear();
    event EventHandler<ActivityEvent>? ActivityAdded;
}
