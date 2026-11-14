# Adds the two charts ExcelJS cannot write.
# Safe to run standalone:  powershell -File add-charts.ps1 -Path <workbook.xlsx>
param(
  [Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path $Path)) { throw "Workbook not found: $Path" }

# Excel stores colours as BGR, so #1F3864 becomes 6567967 and #2E75B6 becomes 11957550.
$NAVY_BGR = 6567967
$BLUE_BGR = 11957550

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$xl.ScreenUpdating = $false

# Indian lakh/crore grouping for the value axis, matching the sheet cells.
# Built from the codepoint because PowerShell 5.1 reads .ps1 files as ANSI and
# would mangle a literal rupee sign into the wrong byte.
$RUPEE = [char]0x20B9
$INR_FMT = '[>=10000000]"' + $RUPEE + '"##\,##\,##\,##0;[>=100000]"' + $RUPEE + '"##\,##\,##0;"' + $RUPEE + '"##,##0'

function Find-Row($ws, $needle) {
  for ($r = 1; $r -le 80; $r++) {
    if ($ws.Cells.Item($r, 1).Text -like $needle) { return $r }
  }
  return $null
}

# Replaces whatever series the new chart came with, so the category and value
# ranges are exactly the ones we name instead of whatever Excel guessed.
function Set-Series($chart, $name, $categories, $values, $color) {
  $series = $chart.SeriesCollection(1)
  $series.Name = $name
  $series.XValues = $categories
  $series.Values = $values
  $series.Format.Fill.ForeColor.RGB = $color
  $series.Format.Line.Visible = 0
  return $series
}

try {
  $wb = $xl.Workbooks.Open($Path)

  # ---- 1. BOD Summary ----
  $bod = $wb.Worksheets.Item("BOD Summary")
  $bod.Activate()
  $head = Find-Row $bod "*annual contribution (chart)*"
  if ($null -eq $head) { $head = 28 }

  $anchor = $bod.Range("A$($head + 1)")
  $shape = $bod.Shapes.AddChart2(-1, 51, $anchor.Left, $anchor.Top, 740, 300)
  $chart = $shape.Chart
  $chart.HasTitle = $true
  $chart.ChartTitle.Text = "BOD-wise Annual Contribution"
  $chart.ChartTitle.Font.Size = 12
  $chart.ChartTitle.Font.Bold = $true
  $chart.ChartTitle.Font.Color = $NAVY_BGR
  $chart.HasLegend = $false
  $chart.PlotArea.Format.Fill.ForeColor.RGB = 16777215

  $bodSeries = Set-Series $chart "Annual Contribution" $bod.Range("A6:A23") $bod.Range("B6:B23") $NAVY_BGR

  try {
    $chart.Axes(1).TickLabels.Font.Size = 7
    $chart.Axes(1).TickLabels.Orientation = -45
  } catch { }
  try {
    $chart.Axes(2).TickLabels.NumberFormat = $INR_FMT
    $chart.Axes(2).TickLabels.Font.Size = 7
    $chart.Axes(2).HasTitle = $true
    $chart.Axes(2).AxisTitle.Text = "Rupees"
    $chart.Axes(2).AxisTitle.Font.Size = 8
  } catch { }
  try {
    $bodSeries.HasDataLabels = $true
    [void]$bodSeries.DataLabels.Select()
    $xl.Selection.NumberFormat = "#,##0"
    $xl.Selection.Font.Size = 7
    $xl.Selection.Position = 3   # xlLabelPositionOutsideEnd
  } catch {
    try { $bodSeries.HasDataLabels = $false } catch { }
  }

  # ---- 2. Monthly Summary ----
  $mon = $wb.Worksheets.Item("Monthly Summary")
  $mon.Activate()
  $head2 = Find-Row $mon "*trend (chart)*"
  if ($null -eq $head2) { $head2 = 20 }

  $anchor2 = $mon.Range("A$($head2 + 1)")
  $shape2 = $mon.Shapes.AddChart2(-1, 51, $anchor2.Left, $anchor2.Top, 640, 270)
  $chart2 = $shape2.Chart
  $chart2.HasTitle = $true
  $chart2.ChartTitle.Text = "Monthly Contribution Trend"
  $chart2.ChartTitle.Font.Size = 12
  $chart2.ChartTitle.Font.Bold = $true
  $chart2.ChartTitle.Font.Color = $NAVY_BGR
  $chart2.HasLegend = $false
  $chart2.PlotArea.Format.Fill.ForeColor.RGB = 16777215

  $monSeries = Set-Series $chart2 "Total Contribution" $mon.Range("A6:A17") $mon.Range("B6:B17") $BLUE_BGR

  try {
    $chart2.Axes(1).TickLabels.Font.Size = 8
  } catch { }
  try {
    $chart2.Axes(2).TickLabels.NumberFormat = $INR_FMT
    $chart2.Axes(2).TickLabels.Font.Size = 7
  } catch { }
  try {
    $monSeries.HasDataLabels = $true
    [void]$monSeries.DataLabels.Select()
    $xl.Selection.NumberFormat = "#,##0"
    $xl.Selection.Font.Size = 7
    $xl.Selection.Position = 3
  } catch {
    try { $monSeries.HasDataLabels = $false } catch { }
  }

  $wb.Worksheets.Item("Report Summary").Activate()
  $wb.Save()
  $wb.Close($true)
  Write-Output "Charts added."
}
finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
