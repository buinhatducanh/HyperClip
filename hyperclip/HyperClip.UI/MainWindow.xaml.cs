using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using HyperClip.UI.ViewModels;

namespace HyperClip.UI;

public partial class MainWindow : Window
{
    public MainWindow(MainViewModel vm)
    {
        InitializeComponent();
        DataContext = vm;
        UpdateMaximizeIcon();
    }

    private void TopBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.LeftButton == MouseButtonState.Pressed)
        {
            if (e.ClickCount == 2)
                MaximizeRestore();
            else
                DragMove();
        }
    }

    private void MinimizeButton_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void MaximizeButton_Click(object sender, RoutedEventArgs e)
    {
        MaximizeRestore();
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private void MaximizeRestore()
    {
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;
    }

    private void Window_StateChanged(object sender, EventArgs e)
    {
        UpdateMaximizeIcon();
    }

    private void UpdateMaximizeIcon()
    {
        // Navigate to the maximize button's template children to toggle icons
        var btn = FindName("MaximizeBtn") as Button;
        if (btn?.Template?.FindName("maxIcon", btn) is System.Windows.Shapes.Path maxIcon &&
            btn.Template.FindName("restoreIcon", btn) is System.Windows.Shapes.Path restoreIcon)
        {
            if (WindowState == WindowState.Maximized)
            {
                maxIcon.Visibility = Visibility.Collapsed;
                restoreIcon.Visibility = Visibility.Visible;
            }
            else
            {
                maxIcon.Visibility = Visibility.Visible;
                restoreIcon.Visibility = Visibility.Collapsed;
            }
        }
    }
}
