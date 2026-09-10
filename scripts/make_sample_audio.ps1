param(
    [string]$OutputPath = "sample-class-note.wav",
    [string]$Text = "This is a test lecture note. Photosynthesis converts light energy into chemical energy in plants."
)

$resolvedOutputPath = Join-Path (Get-Location) $OutputPath

Add-Type -AssemblyName System.Speech
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synthesizer.SetOutputToWaveFile($resolvedOutputPath)
$synthesizer.Speak($Text)
$synthesizer.Dispose()

Write-Host "Created sample audio at $resolvedOutputPath"
