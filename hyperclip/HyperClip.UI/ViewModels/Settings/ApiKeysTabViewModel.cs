using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class ApiKeysTabViewModel : ObservableObject
{
    private readonly IActivityService _activityService;

    [ObservableProperty] private ObservableCollection<ApiKeyInfo> _keys = [];

    public ApiKeysTabViewModel(IActivityService activityService)
    {
        _activityService = activityService;
    }

    [RelayCommand]
    private void AddKey()
    {
        _activityService.AddEntry("API key management coming soon", "info");
    }
}

public class ApiKeyInfo
{
    public string Id { get; set; } = "";
    public string KeyPrefix { get; set; } = "";
    public string Status { get; set; } = "healthy";
    public int UsedToday { get; set; }
    public int QuotaLimit { get; set; } = 10000;
}
