using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class ProjectsTabViewModel : ObservableObject
{
    private readonly IActivityService _activityService;

    [ObservableProperty] private ObservableCollection<ProjectInfo> _projects = [];

    public ProjectsTabViewModel(IActivityService activityService)
    {
        _activityService = activityService;
        // Placeholder — OAuth project management will be implemented when
        // the C# OAuth flow is ported from Electron's token_manager.ts
    }

    [RelayCommand]
    private void AddProject()
    {
        _activityService.AddEntry("Project management coming soon — requires OAuth implementation", "info");
    }
}

public class ProjectInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int UsedToday { get; set; }
    public int QuotaLimit { get; set; } = 10000;
    public bool IsExhausted { get; set; }
}
