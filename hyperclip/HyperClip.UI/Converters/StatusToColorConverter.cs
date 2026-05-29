using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using HyperClip.Core.Enums;

namespace HyperClip.UI.Converters;

public class StatusToColorConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is not WorkspaceStatus status) return Brushes.Gray;
        return status switch
        {
            WorkspaceStatus.New => new SolidColorBrush(Color.FromRgb(0xA3, 0xA3, 0xA3)),
            WorkspaceStatus.Waiting => new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B)),
            WorkspaceStatus.Downloading => new SolidColorBrush(Color.FromRgb(0x3B, 0x82, 0xF6)),
            WorkspaceStatus.Ready => new SolidColorBrush(Color.FromRgb(0x10, 0xB9, 0x81)),
            WorkspaceStatus.Editing => new SolidColorBrush(Color.FromRgb(0x3B, 0x82, 0xF6)),
            WorkspaceStatus.Rendering => new SolidColorBrush(Color.FromRgb(0x8B, 0x5C, 0xF6)),
            WorkspaceStatus.Done => new SolidColorBrush(Color.FromRgb(0x10, 0xB9, 0x81)),
            WorkspaceStatus.Error => new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44)),
            _ => Brushes.Gray
        };
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
