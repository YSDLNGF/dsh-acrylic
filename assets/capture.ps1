param(
  [Parameter(Mandatory=$true)][string]$Out,
  [Parameter(Mandatory=$true)][string]$Rect
)

# Rect 形如 "578,624,1296,828"
$parts = $Rect -split ','
$x = [int]$parts[0]; $y = [int]$parts[1]; $w = [int]$parts[2]; $h = [int]$parts[3]

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$full = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($full)
$g.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$g.Dispose()

$crop = New-Object System.Drawing.Bitmap($w, $h)
$g2 = [System.Drawing.Graphics]::FromImage($crop)
$g2.DrawImage($full, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle($x, $y, $w, $h)), [System.Drawing.GraphicsUnit]::Pixel)
$g2.Dispose()

$crop.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$crop.Dispose()
$full.Dispose()

Write-Output "已裁剪 ${w}x${h} -> $Out"
