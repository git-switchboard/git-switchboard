$ErrorActionPreference = 'Stop'
$toolsDir = "$(Split-Path -parent $MyInvocation.MyCommand.Definition)"

$packageArgs = @{
  packageName    = 'git-switchboard'
  url64bit       = '{{URL}}'
  fileFullPath   = "$toolsDir\git-switchboard.exe"
  checksum64     = '{{CHECKSUM}}'
  checksumType64 = 'sha256'
}

Get-ChocolateyWebFile @packageArgs
