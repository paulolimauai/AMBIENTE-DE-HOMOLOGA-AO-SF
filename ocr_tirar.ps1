Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Foundation, ContentType=WindowsRuntime]
function Await($op, $type) {
  $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
  $g = $m.MakeGenericMethod($type)
  $task = $g.Invoke($null, @($op))
  $task.Wait()
  return $task.Result
}
$img = $args[0]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($img)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$out = New-Object System.Collections.Generic.List[string]
foreach ($line in $result.Lines) {
  $txt = $line.Text
  $x = 0; $y = 0
  if ($line.Words.Count -gt 0) {
    $r = $line.Words[0].BoundingRect
    $x = [int]$r.X; $y = [int]$r.Y
  }
  $out.Add(("{0},{1} | {2}" -f $x, $y, $txt))
}
[System.IO.File]::WriteAllLines((Join-Path $PSScriptRoot 'ocr_tirar.txt'), $out, [System.Text.Encoding]::UTF8)
Write-Output ("linhas: " + $out.Count)
