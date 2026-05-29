using System.Windows;
using System.Windows.Input;
using HyperClip.UI.ViewModels;

namespace HyperClip.UI;

public partial class MainWindow : Window
{
    public MainWindow(MainViewModel vm)
    {
        InitializeComponent();
        DataContext = vm;
        MouseLeftButtonDown += (s, e) =>
        {
            if (e.LeftButton == MouseButtonState.Pressed) DragMove();
        };
    }
}
