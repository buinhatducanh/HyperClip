# scratch/test_formula.py

char_widths = {
    "a":  0.76, "b":  0.84, "c":  0.76, "d":  0.84, "e":  0.76, "f":  0.46,
    "g":  0.84, "h":  0.84, "i":  0.38, "j":  0.38, "k":  0.76, "l":  0.38,
    "m":  1.22, "n":  0.84, "o":  0.84, "p":  0.84, "q":  0.84, "r":  0.53,
    "s":  0.76, "t":  0.46, "u":  0.84, "v":  0.76, "w":  1.07, "x":  0.76,
    "y":  0.76, "z":  0.69,
    "A":  0.99, "B":  0.99, "C":  0.99, "D":  0.99, "E":  0.92, "F":  0.84,
    "G":  1.07, "H":  0.99, "I":  0.38, "J":  0.76, "K":  0.99, "L":  0.84,
    "M":  1.14, "N":  0.99, "O":  1.07, "P":  0.92, "Q":  1.07, "R":  0.99,
    "S":  0.92, "T":  0.84, "U":  0.99, "V":  0.92, "W":  1.30, "X":  0.92,
    "Y":  0.92, "Z":  0.84,
    "0":  0.76, "1":  0.76, "2":  0.76, "3":  0.76, "4":  0.76, "5":  0.76,
    "6":  0.76, "7":  0.76, "8":  0.76, "9":  0.76,
    " ":  0.33, "-":  0.46, "_":  0.76, "+":  0.80, "=":  0.80, "[":  0.46,
    "]":  0.46, "{":  0.53, "}":  0.53, "|":  0.38, ";":  0.46, ":":  0.46,
    "'":  0.33, ",":  0.38, ".":  0.38, "/":  0.38, "<":  0.80, ">":  0.80,
    "?":  0.84
}

def estimate_font_size(text, canvas_w, max_size):
    # Sum character widths
    total_em = 0.0
    for c in text:
        total_em += char_widths.get(c, 0.75) # Default 0.75 for unknown chars/Unicode
    
    # Calculate GDI+ MeasureString width:
    # Width = (total_em + 0.44) * font_size
    # We want Width <= canvas_w * 0.95
    # So font_size <= (canvas_w * 0.95) / (total_em + 0.44)
    target_w = canvas_w * 0.95
    font_size = int(target_w / (total_em + 0.44))
    
    # PowerShell starts at max_size, and decrements by 2 until it fits
    if font_size >= max_size:
        return max_size
    
    # Make it match the step size (e.g. decrement by 2)
    # Let's see: we want the largest even number <= font_size if start was even, etc.
    # Or just return the nearest even number if that's what PowerShell does.
    # PowerShell loop: starting size is 202 (even), decrements by 2. So size is always even.
    # Let's align to even number:
    font_size = (font_size // 2) * 2
    return max(8, font_size)

test_cases = [
    ("Short", 202),
    ("Medium Length Title", 74),
    ("A Much Longer Video Title That Might Wrap", 34),
    ("This Is An Extremely Long Video Title That Definitely Needs To Be Scaled Down Significant", 16),
    ("PART 1: Konnor Griffin Highlights", 44)
]

print("Comparing estimated vs actual font sizes:")
for title, actual in test_cases:
    estimated = estimate_font_size(title, 1080, 202)
    print(f"Title: {title[:30]:<30} | Actual: {actual:<3} | Estimated: {estimated:<3} | Diff: {estimated - actual}")
