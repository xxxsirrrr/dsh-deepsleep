# 启动手机/平板访问 DSH 的链路（一键，可重复运行）
# 手机链路 = 密码门代理(端口可配) -> appliance 的 dsh web(127.0.0.1:3080)
# 首次运行会依次提示：设置访问密码（必填）、设置代理端口（可选，回车用 3082）。
# 用法：双击 start-mobile-link.cmd（或 powershell -File start-mobile-link.ps1）

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$proxy = Join-Path $here 'lan-proxy-3080.mjs'
$passwordFile = Join-Path $here 'proxy-password.txt'
$portFile = Join-Path $here 'proxy-port.txt'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host '未找到 node，请先安装 Node.js 并加入 PATH。'; Read-Host '回车退出'; exit 1 }

function Test-Port($p) { [bool](Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) }

# 0. appliance 的 dsh web 必须在 3080 上活着
if (-not (Test-Port 3080)) {
  Write-Host '警告: 3080 上没有 dsh web（appliance 服务器未运行？）'
  Write-Host '请先确认电脑上 DSH GUI 正常，再重新运行本脚本。'
  Read-Host '回车退出'; exit 1
}

# 1. 当前局域网 IPv4（排除回环/VPN/链路本地）
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '26.*' } |
  Sort-Object InterfaceAlias | Select-Object -First 1).IPAddress
if (-not $ip) { Write-Host '未找到局域网 IP（请先连接 Wi-Fi）'; Read-Host '回车退出'; exit 1 }

# 2. 首次运行：设置访问密码（必填）
if (-not (Test-Path $passwordFile)) {
  Write-Host ''
  Write-Host '===== 首次设置：手机访问密码（必填）====='
  $p1 = Read-Host '请输入密码' -AsSecureString
  $p2 = Read-Host '请再次输入确认' -AsSecureString
  $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1)
  $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2)
  try {
    $s1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1)
    $s2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)
  }
  if ($s1 -ne $s2) { Write-Host '两次输入不一致，请重新运行本脚本。'; Read-Host '回车退出'; exit 1 }
  if ([string]::IsNullOrWhiteSpace($s1) -or $s1.Length -lt 4) { Write-Host '密码至少 4 个字符。'; Read-Host '回车退出'; exit 1 }
  Set-Content -Path $passwordFile -Value $s1 -Encoding ASCII -NoNewline
  Write-Host '密码已保存。改密码：删除 proxy-password.txt 后重新运行本脚本。'
}

# 3. 首次运行：设置代理端口（可选，回车用默认 3082）
$port = 3082
if (-not (Test-Path $portFile)) {
  Write-Host ''
  $answer = Read-Host '代理端口（可选，直接回车用默认 3082）'
  if ($answer -match '^\d+$' -and [int]$answer -ge 1 -and [int]$answer -le 65535) {
    $port = [int]$answer
  } else {
    $port = 3082
  }
  Set-Content -Path $portFile -Value $port -Encoding ASCII -NoNewline
  Write-Host "端口已保存为 $port。改端口：删除 proxy-port.txt 后重新运行本脚本。"
} else {
  $port = [int](Get-Content $portFile -Raw).Trim()
}

# 4. LAN 代理（密码门 + 改写 Host 头）
if (Test-Port $port) {
  Write-Host "端口 $port 上已有代理在运行，跳过启动"
} else {
  $env:DSH_MOBILE_PORT = "$port"
  Start-Process $node -ArgumentList @('"' + $proxy + '"') -WindowStyle Hidden
  Start-Sleep -Seconds 2
  if (-not (Test-Port $port)) { Write-Host '代理启动失败'; Read-Host '回车退出'; exit 1 }
}

Write-Host ''
Write-Host '====================================='
Write-Host " 手机/平板访问:  http://${ip}:${port}"
Write-Host " 电脑访问:       http://127.0.0.1:3080"
Write-Host '====================================='
Write-Host '（首次打开需输入访问密码；两边连同一台服务器，状态实时同步）'
Write-Host '（仅限可信网络使用；重复双击本脚本是无害的）'
Read-Host '回车关闭本窗口'
