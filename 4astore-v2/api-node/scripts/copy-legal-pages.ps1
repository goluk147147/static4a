# Copies the original static legal/help pages into scripts/legal-seed and rewrites
# their links to the React SPA routes. These copies are only SEED data for
# import-legal-pages.ts — the live pages come from the `pages` table (Admin → Pages).
param([string]$Source = (Resolve-Path "$PSScriptRoot\..\..\..").Path)

$dest = Join-Path $PSScriptRoot 'legal-seed'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$pages = 'help-support.html', 'privacy-policy.html', 'terms.html', 'account-deletion.html'

# Original link target -> new URL
$map = [ordered]@{
  'assets/css/'           = '/legacy/css/'
  'assets/images/'        = '/legacy/images/'
  './'                    = '/'
  'index.html'            = '/'
  'products'              = '/products'
  'products.html'         = '/products'
  'cart.html'             = '/cart'
  'cart'                  = '/cart'
  'checkout.html'         = '/checkout'
  'order-history'         = '/orders'
  'order-history.html'    = '/orders'
  'profile'               = '/profile'
  'profile.html'          = '/profile'
  'login'                 = '/login'
  'login.html'            = '/login'
  'track.html'            = '/orders'
  'help-support.html'     = '/legacy-pages/help-support.html'
  'privacy-policy.html'   = '/legacy-pages/privacy-policy.html'
  'terms.html'            = '/legacy-pages/terms.html'
  'account-deletion.html' = '/legacy-pages/account-deletion.html'
  'account-deletion'      = '/legacy-pages/account-deletion.html'
}

$report = @()
foreach ($p in $pages) {
  $html = Get-Content (Join-Path $Source $p) -Raw -Encoding UTF8
  $html = [regex]::Replace($html, '(href|src)="([^"]*)"', {
    param($m)
    $attr = $m.Groups[1].Value
    $val = $m.Groups[2].Value
    foreach ($k in $map.Keys) {
      if ($k.EndsWith('/') -and $val.StartsWith($k)) { return "$attr=`"$($map[$k])$($val.Substring($k.Length))`"" }
      if ($val -eq $k) { return "$attr=`"$($map[$k])`"" }
    }
    return $m.Value
  })
  [IO.File]::WriteAllText((Join-Path $dest $p), $html, (New-Object Text.UTF8Encoding $false))
  $left = [regex]::Matches($html, '(?:href|src)="((?!/|https?:|mailto:|tel:|#|data:)[^"]*)"') | ForEach-Object { $_.Groups[1].Value }
  $report += "$p unmapped=[$($left -join ',')]"
}
$report
