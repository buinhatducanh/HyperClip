using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;

namespace HyperClip.UI.Converters;

public class ActivityLogTypeToBrushConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        var type = value as string ?? "info";
        return type.ToLowerInvariant() switch
        {
            "error" => new SolidColorBrush(Color.FromRgb(0xEF, 0x44, 0x44)),
            "warning" => new SolidColorBrush(Color.FromRgb(0xF5, 0x9E, 0x0B)),
            "success" => new SolidColorBrush(Color.FromRgb(0x10, 0xB9, 0x81)),
            "download" => new SolidColorBrush(Color.FromRgb(0x3B, 0x82, 0xF6)),
            "render" => new SolidColorBrush(Color.FromRgb(0x8B, 0x5C, 0xF6)),
            _ => new SolidColorBrush(Color.FromRgb(0x88, 0x88, 0x88)),
        };
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
