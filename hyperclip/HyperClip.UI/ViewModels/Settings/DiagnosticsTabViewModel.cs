using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using HyperClip.Core.Interfaces;

namespace HyperClip.UI.ViewModels.Settings;

public partial class DiagnosticsTabViewModel : ObservableObject
{
    private readonly IDiagnosticsService _diagnostics;

    [ObservableProperty] private bool _isHealthy;
    [ObservableProperty] private bool _isRunning;
    [ObservableProperty] private string _statusText = "Not run yet";
    [ObservableProperty] private ObservableCollection<DiagnosticIssue> _issues = [];

    public DiagnosticsTabViewModel(IDiagnosticsService diagnostics)
    {
        _diagnostics = diagnostics;
    }

    [RelayCommand]
    private async Task RunDiagnosticsAsync()
    {
        IsRunning = true;
        StatusText = "Running...";
        try
        {
            var result = await _diagnostics.RunDiagnosticsAsync();
            IsHealthy = result.IsHealthy;
            Issues = new ObservableCollection<DiagnosticIssue>(result.Issues);
            StatusText = result.IsHealthy ? "All healthy" : $"{result.Issues.Count} issue(s) found";
        }
        catch (Exception ex)
        {
            StatusText = $"Error: {ex.Message}";
        }
        finally { IsRunning = false; }
    }
}
