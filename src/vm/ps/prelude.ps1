[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'

# fecha as configuracoes do Windows da VM que o SOS PC abriu (tenta algumas vezes: o Windows demora a soltar)
function Close-SosHives {
    foreach ($h in 'HKLM\SOS_SOFT', 'HKLM\SOS_SYS', 'HKLM\SOS_USER') {
        for ($i = 0; $i -lt 6; $i++) {
            cmd.exe /c ('reg query ' + $h + ' >nul 2>&1')
            if ($LASTEXITCODE -ne 0) { break }
            [gc]::Collect(); [gc]::WaitForPendingFinalizers()
            cmd.exe /c ('reg unload ' + $h + ' >nul 2>&1')
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 2
        }
    }
}

# Steam: o "gldriverquery" procura o OpenGL do driver, que nao existe em VMs com GPU-P, e mostra
# "LoadLibrary failed with error 126" toda vez que a Steam abre. Troca por um programa que nao faz nada,
# nas duas visoes do registro (a Steam e de 32 bits, entao o Windows le a de 32).
function Set-SosSteamGlFix([string]$root) {
    & reg.exe load 'HKLM\SOS_GLFIX' ($root + '\Windows\System32\config\SOFTWARE') | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Host 'Aviso: nao consegui aplicar a correcao da Steam (gldriverquery).'; return }
    try {
        foreach ($base in 'HKLM\SOS_GLFIX', 'HKLM\SOS_GLFIX\WOW6432Node') {
            foreach ($n in 'gldriverquery.exe', 'gldriverquery64.exe') {
                & reg.exe add ($base + '\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\' + $n) /v Debugger /t REG_SZ /d 'C:\Windows\System32\systray.exe' /f | Out-Null
            }
        }
        Write-Host 'Correcao do aviso de OpenGL da Steam aplicada.'
    }
    finally {
        [gc]::Collect(); [gc]::WaitForPendingFinalizers(); Start-Sleep -Seconds 1
        cmd.exe /c 'reg unload HKLM\SOS_GLFIX >nul 2>&1'
    }
}


function Stop-SosVM([string]$n) {
    $vm = Get-VM -Name $n
    if ($vm.State -eq 'Off') { return $false }
    Write-Host 'Desligando a VM (desligamento normal do Windows dela)...'
    Stop-VM -Name $n -Force
    $t = 0
    while ((Get-VM -Name $n).State -ne 'Off' -and $t -lt 120) { Start-Sleep -Seconds 2; $t += 2 }
    if ((Get-VM -Name $n).State -ne 'Off') {
        Write-Host 'A VM nao desligou sozinha em 2 minutos: desligando na forca.'
        Stop-VM -Name $n -TurnOff -Force
    }
    Write-Host 'VM desligada.'
    return $true
}

function Get-SosPartitionPath([string]$gpuId) {
    $parts = @()
    try { $parts = @(Get-VMHostPartitionableGpu -EA Stop) } catch { try { $parts = @(Get-VMPartitionableGpu -EA Stop) } catch {} }
    $k = $gpuId.Replace('\', '#').ToUpper()
    $p = $parts | Where-Object { $_.Name.ToUpper().Contains($k) } | Select-Object -First 1
    if ($p) { return $p.Name }
    return $null
}

function Add-SosGpuAdapter([string]$vmName, [string]$gpuId) {
    Set-VM -Name $vmName -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
    try { Set-VM -Name $vmName -GuestControlledCacheTypes $true -LowMemoryMappedIoSpace 1GB -HighMemoryMappedIoSpace 32GB } catch { Write-Host ('Aviso: ' + $_.Exception.Message) }
    Get-VMGpuPartitionAdapter -VMName $vmName -EA SilentlyContinue | Remove-VMGpuPartitionAdapter
    $path = Get-SosPartitionPath $gpuId
    $c = Get-Command Add-VMGpuPartitionAdapter
    if ($path -and $c.Parameters.ContainsKey('InstancePath')) { Add-VMGpuPartitionAdapter -VMName $vmName -InstancePath $path }
    else { Add-VMGpuPartitionAdapter -VMName $vmName }
    Set-VMGpuPartitionAdapter -VMName $vmName `
      -MinPartitionVRAM 80000000 -MaxPartitionVRAM 100000000 -OptimalPartitionVRAM 100000000 `
      -MinPartitionEncode 80000000 -MaxPartitionEncode 100000000 -OptimalPartitionEncode 100000000 `
      -MinPartitionDecode 80000000 -MaxPartitionDecode 100000000 -OptimalPartitionDecode 100000000 `
      -MinPartitionCompute 80000000 -MaxPartitionCompute 100000000 -OptimalPartitionCompute 100000000
    Write-Host 'Placa adicionada a VM.'
}

# copia os drivers da placa para um Windows ja aberto numa letra (ex.: 'W:')
function Copy-SosGpuDriversTo([string]$letter, [string]$gpuId) {
    $dev = Get-PnpDevice -InstanceId $gpuId
    Write-Host ('Placa: ' + $dev.FriendlyName)
    $script:GuestBuild = (Get-Item ($letter + '\Windows\System32\ntoskrnl.exe')).VersionInfo.FileBuildPart
    $store = $letter + '\Windows\System32\HostDriverStore\FileRepository'
    New-Item -ItemType Directory -Force -Path $store | Out-Null
    $copied = @{}
    function Copy-Pkg([string]$path) {
        $low = $path.ToLower()
        $i = $low.IndexOf('\driverstore\filerepository\')
        if ($i -lt 0) { return $false }
        $rest = $path.Substring($i + '\driverstore\filerepository\'.Length)
        $pkg = $rest.Split('\')[0]
        if ($copied.ContainsKey($pkg)) { return $true }
        $copied[$pkg] = $true
        $src = $path.Substring(0, $i) + '\DriverStore\FileRepository\' + $pkg
        $dst = Join-Path $store $pkg
        if (-not (Test-Path $dst)) { Copy-Item -Path $src -Destination $dst -Recurse -Force; Write-Host ('  pacote do driver: ' + $pkg) }
        return $true
    }
    if ($dev.Service) {
        $sp = (Get-CimInstance Win32_SystemDriver -Filter ("Name='" + $dev.Service + "'")).PathName
        if ($sp) { [void](Copy-Pkg $sp) }
    }

    # Pacotes extras do driver: na AMD (e em outras), OpenGL, Vulkan e OpenCL vem em pacotes separados
    # (ex.: amdogl.inf). Sem eles a Steam e jogos OpenGL mostram "LoadLibrary failed with error 126" na VM.
    # 1) caminhos que o proprio registro da placa aponta (OpenGLDriverName, VulkanDriverName...)
    try {
        $drvKey = (Get-PnpDeviceProperty -InstanceId $gpuId -KeyName 'DEVPKEY_Device_Driver' -EA Stop).Data
        $props = Get-ItemProperty ('HKLM:\SYSTEM\CurrentControlSet\Control\Class\' + $drvKey) -EA Stop
        foreach ($pp in $props.PSObject.Properties) {
            if ($pp.Name -like 'PS*') { continue }
            foreach ($v in @($pp.Value)) {
                if ($v -is [string] -and $v -match '(?i)\\driverstore\\filerepository\\') {
                    $full = $v
                    if ($full -notmatch '^[A-Za-z]:') { $full = $env:SystemRoot + '\System32' + $full.Substring($full.ToLower().IndexOf('\driverstore')) }
                    [void](Copy-Pkg $full)
                }
            }
        }
    } catch { Write-Host ('Aviso (pacotes extras do registro): ' + $_.Exception.Message) }
    # 2) componentes de software do driver ligados a placa (SWC\..., como AMD OpenGL/Vulkan/OpenCL).
    #    Monitores e outros filhos (DISPLAY\..., etc.) ficam de fora: os drivers deles sao do proprio Windows.
    $ids = @($gpuId)
    try { $ids += @((Get-PnpDeviceProperty -InstanceId $gpuId -KeyName 'DEVPKEY_Device_Children' -EA Stop).Data | Where-Object { $_ -like 'SWC\*' }) } catch {}

    Write-Host 'Procurando os arquivos do driver (pode levar alguns minutos)...'
    $files = @()
    foreach ($id in $ids) {
        if (-not $id) { continue }
        $drv = Get-CimInstance Win32_PnPSignedDriver -Filter ("DeviceID='" + $id.Replace('\', '\\') + "'")
        if (-not $drv) { continue }
        try { $files += @($drv | Get-CimAssociatedInstance -ResultClassName CIM_DataFile -EA Stop | ForEach-Object { $_.Name }) } catch {}
    }
    if ($files.Count -eq 0) {
        $files = @(Get-CimInstance Win32_PNPSignedDriverCIMDataFile | Where-Object { $ids -contains $_.Antecedent.DeviceID } |
                   ForEach-Object { $_.Dependent.Name })
    }
    $n = 0
    $skip = 0
    foreach ($f in $files) {
        if (-not $f -or -not (Test-Path $f)) { continue }
        if (Copy-Pkg $f) { continue }
        # arquivos que ja fazem parte do Windows da VM (inf, catalogos) nunca sao substituidos
        if ($f -match '(?i)\\windows\\(inf|system32\\catroot2?|winsxs|servicing)\\') { continue }
        $dest = $letter + $f.Substring(2)
        try {
            $dir = Split-Path $dest -Parent
            if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
            Copy-Item -Path $f -Destination $dest -Force -EA Stop
            $n++
        } catch { $skip++ }
    }
    if ($skip) { Write-Host ('  ' + $skip + ' arquivo(s) avulso(s) do driver nao puderam ser copiados (ja existem protegidos na VM); seguindo.') }
    Write-Host ('Arquivos copiados: ' + $copied.Count + ' pacote(s) do driver e ' + $n + ' arquivo(s) avulsos.')
}

# abre o disco da VM (desligada) e devolve a letra do Windows dela (ex.: 'W:'); feche com Close-SosVhd
function Open-SosVhd([string]$vmName) {
    $vhd = (Get-VMHardDiskDrive -VMName $vmName | Where-Object { $_.Path } | Select-Object -First 1).Path
    if (-not $vhd) { throw 'A VM nao tem disco virtual.' }
    Write-Host ('Abrindo o disco da VM: ' + $vhd)
    $disk = Mount-VHD -Path $vhd -PassThru | Get-Disk
    $script:SosVhd = $vhd
    $script:SosVhdLetters = @()
    foreach ($p in @(Get-Partition -DiskNumber $disk.Number)) {
        if (-not $p.DriveLetter -and $p.Type -eq 'Basic' -and $p.Size -gt 10GB) {
            try { $p | Add-PartitionAccessPath -AssignDriveLetter -EA Stop } catch {}
        }
    }
    foreach ($p in @(Get-Partition -DiskNumber $disk.Number)) {
        if ($p.DriveLetter -and (Test-Path ($p.DriveLetter + ':\Windows\System32'))) { $script:SosVhdLetters += [string]$p.DriveLetter; return ($p.DriveLetter + ':') }
    }
    Close-SosVhd
    throw 'Nao achei o Windows dentro do disco da VM.'
}
function Close-SosVhd {
    if (-not $script:SosVhd) { return }
    Write-Host 'Fechando o disco da VM...'
    Close-SosHives
    foreach ($l in @($script:SosVhdLetters)) {
        try { Get-Partition -DriveLetter $l -EA Stop | Remove-PartitionAccessPath -AccessPath ($l + ':\') -EA Stop } catch {}
        cmd.exe /c ('mountvol ' + $l + ': /D >nul 2>&1')
    }
    Dismount-VHD -Path $script:SosVhd -EA SilentlyContinue
    $script:SosVhd = $null
}

function Copy-SosGpuDrivers([string]$vmName, [string]$gpuId) {
    $letter = Open-SosVhd $vmName
    try { Copy-SosGpuDriversTo $letter $gpuId }
    finally { Close-SosVhd }
}

# copia o Piece Helper (pasta $HelperSrc) para o Windows aberto na letra e cria o atalho para todos os usuarios
function Install-SosHelper([string]$letter) {
    $dst = $letter + '\Piece Helper'
    Write-Host 'Copiando o Piece Helper para dentro da VM...'
    $null = robocopy $HelperSrc $dst /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) { throw 'Nao consegui copiar o Piece Helper para a VM.' }
    $desk = $letter + '\Users\Public\Desktop'
    New-Item -ItemType Directory -Force -Path $desk | Out-Null
    $sh = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desk 'Piece Helper.lnk'))
    $sh.TargetPath = 'C:\Piece Helper\PieceHelper.exe'
    $sh.WorkingDirectory = 'C:\Piece Helper'
    $sh.IconLocation = 'C:\Piece Helper\PieceHelper.exe,0'
    $sh.Save()
    Write-Host 'Piece Helper instalado na VM, com atalho na area de trabalho.'
}
