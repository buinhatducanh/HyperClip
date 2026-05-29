using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace HyperClip.UI.Converters;

public class StringEqualsVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        var strValue = value as string ?? "";
        var target = parameter as string ?? "";
        return string.Equals(strValue, target, StringComparison.OrdinalIgnoreCase)
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
