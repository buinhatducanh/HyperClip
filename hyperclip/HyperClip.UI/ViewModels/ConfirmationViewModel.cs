using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace HyperClip.UI.ViewModels;

public partial class ConfirmationViewModel : ObservableObject
{
    [ObservableProperty] private string _title = "Confirm";
    [ObservableProperty] private string _message = "";
    [ObservableProperty] private string _confirmText = "Confirm";
    [ObservableProperty] private string _cancelText = "Cancel";

    public bool? Result { get; private set; }
    public Action<bool?>? CloseAction { get; set; }

    [RelayCommand]
    private void Confirm()
    {
        Result = true;
        CloseAction?.Invoke(true);
    }

    [RelayCommand]
    private void Cancel()
    {
        Result = false;
        CloseAction?.Invoke(false);
    }
}
