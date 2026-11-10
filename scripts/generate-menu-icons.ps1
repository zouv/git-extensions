# Generates the small colored icons used by the Windows Explorer context menu.
# The icons are embedded in the application binary at build time; this script is
# only needed when the icon set changes. Requires Windows PowerShell 5.1+ and
# the Segoe MDL2 Assets font (included with Windows 10/11).
param(
    [string]$PreviewPath = ""
)

Add-Type -AssemblyName System.Drawing

$OutputDir = Join-Path $PSScriptRoot "..\src-tauri\icons\menu"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Segoe MDL2 Assets codepoints; regenerate the .ico files after changing them.
$Icons = @(
    @{ Name = "clone";                  Glyph = 0xE8C8; Color = "#2563EB" },
    @{ Name = "create-repository";      Glyph = 0xE8F4; Color = "#2563EB" },
    @{ Name = "commit";                 Glyph = 0xE930; Color = "#059669" },
    @{ Name = "open-repository";        Glyph = 0xE838; Color = "#2563EB" },
    @{ Name = "pull";                   Glyph = 0xE896; Color = "#0D9488" },
    @{ Name = "push";                   Glyph = 0xE898; Color = "#0D9488" },
    @{ Name = "view-stash";             Glyph = 0xE7B8; Color = "#B45309" },
    @{ Name = "view-changes";           Glyph = 0xE8FD; Color = "#059669" },
    @{ Name = "checkout-branch";        Glyph = 0xE902; Color = "#7C3AED" },
    @{ Name = "checkout-revision";      Glyph = 0xE81C; Color = "#7C3AED" },
    @{ Name = "create-branch";          Glyph = 0xE710; Color = "#7C3AED" },
    @{ Name = "open-with-difftool";     Glyph = 0xE8AB; Color = "#475569" },
    @{ Name = "file-history";           Glyph = 0xE81C; Color = "#475569" },
    @{ Name = "reset-file-changes";     Glyph = 0xE7A7; Color = "#EA580C" },
    @{ Name = "add-files";              Glyph = 0xE710; Color = "#059669" },
    @{ Name = "apply-patch";            Glyph = 0xE77F; Color = "#059669" },
    @{ Name = "settings";               Glyph = 0xE713; Color = "#64748B" },
    @{ Name = "repository-settings";    Glyph = 0xE838; Color = "#0EA5E9" },
    @{ Name = "view-files";             Glyph = 0xE7C3; Color = "#0891B2" },
    @{ Name = "rename";                 Glyph = 0xE8AC; Color = "#D97706" },
    @{ Name = "others";                 Glyph = 0xE712; Color = "#64748B" }
)

$Sizes = @(16, 20, 24, 32, 40, 48)

function New-RoundedRectangle([float]$x, [float]$y, [float]$width, [float]$height, [float]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $radius * 2
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-IconPng([int]$size, [int]$glyph, [System.Drawing.Color]$color) {
    $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $inset = [Math]::Max(0.5, $size * 0.045)
    $radius = [Math]::Max(2.0, $size * 0.22)
    $path = New-RoundedRectangle $inset $inset ($size - $inset * 2) ($size - $inset * 2) $radius
    $brush = New-Object System.Drawing.SolidBrush $color
    $graphics.FillPath($brush, $path)

    $fontSize = [Math]::Max(7.0, $size * 0.58)
    $font = New-Object System.Drawing.Font "Segoe MDL2 Assets", $fontSize, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF 0, (-$size * 0.02), $size, $size
    $graphics.DrawString([string][char]$glyph, $font, [System.Drawing.Brushes]::White, $rect, $format)

    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)

    $format.Dispose(); $font.Dispose(); $brush.Dispose(); $path.Dispose()
    $graphics.Dispose(); $bitmap.Dispose()
    # Comma prevents PowerShell from unrolling the byte array into scalar outputs.
    return ,$stream.ToArray()
}

function Write-Ico([string]$path, $images) {
    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter $stream
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$images.Count)

    $offset = 6 + 16 * $images.Count
    foreach ($image in $images) {
        $size = $image.Size
        $dimension = if ($size -ge 256) { 0 } else { $size }
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]$dimension)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$image.Bytes.Length)
        $writer.Write([UInt32]$offset)
        $offset += $image.Bytes.Length
    }
    foreach ($image in $images) {
        $writer.Write([byte[]]$image.Bytes)
    }
    $writer.Flush()
    [System.IO.File]::WriteAllBytes($path, $stream.ToArray())
    $writer.Dispose(); $stream.Dispose()
}

foreach ($icon in $Icons) {
    $color = [System.Drawing.ColorTranslator]::FromHtml($icon.Color)
    $images = @()
    foreach ($size in $Sizes) {
        $images += @{ Size = $size; Bytes = (New-IconPng $size $icon.Glyph $color) }
    }
    Write-Ico (Join-Path $OutputDir ($icon.Name + ".ico")) $images
}

if ($PreviewPath) {
    $preview = New-Object System.Drawing.Bitmap 900, 400
    $graphics = [System.Drawing.Graphics]::FromImage($preview)
    $graphics.Clear([System.Drawing.Color]::White)
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $labelFont = New-Object System.Drawing.Font "Consolas", 10
    for ($i = 0; $i -lt $Icons.Count; $i++) {
        $icon = $Icons[$i]
        $x = ($i % 8) * 110
        $y = [Math]::Floor($i / 8) * 100
        $image = [System.Drawing.Image]::FromFile((Join-Path $OutputDir ($icon.Name + ".ico")))
        $graphics.DrawImage($image, $x + 8, $y + 6, 48, 48)
        $graphics.DrawImage($image, $x + 8, $y + 56, 16, 16)
        $graphics.DrawImage($image, $x + 30, $y + 56, 32, 32)
        $graphics.DrawString($icon.Name, $labelFont, [System.Drawing.Brushes]::DimGray, $x + 4, $y + 78)
        $image.Dispose()
    }
    $preview.Save($PreviewPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $labelFont.Dispose(); $graphics.Dispose(); $preview.Dispose()
}

Write-Host ("Wrote {0} icons to {1}" -f $Icons.Count, (Resolve-Path $OutputDir))
