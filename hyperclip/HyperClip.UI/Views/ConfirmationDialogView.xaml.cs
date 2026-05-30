using HyperClip.UI.ViewModels;

namespace HyperClip.UI.Views;

public partial class ConfirmationDialogView : System.Windows.Window
{
    public ConfirmationDialogView(ConfirmationViewModel vm)
    {
        InitializeComponent();
        DataContext = vm;
        vm.CloseAction = result =>
        {
            DialogResult = result;
            Close();
        };
    }
}
