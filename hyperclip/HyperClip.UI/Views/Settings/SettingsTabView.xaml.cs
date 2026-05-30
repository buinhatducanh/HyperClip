using System.Globalization;
using System.Windows.Data;

namespace HyperClip.UI.Views.Settings;

public partial class SettingsTabView : System.Windows.Controls.UserControl
{
    public SettingsTabView()
    {
        InitializeComponent();
    }
}

public class StorageFormatConverter : IValueConverter
{
    public static readonly StorageFormatConverter Instance = new();

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is long bytes) return bytes switch
        {
            > 1073741824 => $"{bytes / 1073741824.0:F1} GB",
            > 1048576 => $"{bytes / 1048576.0:F1} MB",
            > 1024 => $"{bytes / 1024.0:F1} KB",
            _ => $"{bytes} B"
        };
        return "0 B";
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
