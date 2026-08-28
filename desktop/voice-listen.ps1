param([int]$TimeoutSeconds = 22)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech

$recognizerInfo = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
  Where-Object { $_.Culture.Name -like 'en-*' } |
  Select-Object -First 1

if (-not $recognizerInfo) {
  throw 'No English Windows speech recognizer is installed.'
}

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizerInfo)
try {
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToDefaultAudioDevice()
  $result = $engine.Recognize([TimeSpan]::FromSeconds([Math]::Max(3, $TimeoutSeconds)))
  if (-not $result) { exit 2 }
  Write-Output $result.Text
} finally {
  $engine.Dispose()
}
