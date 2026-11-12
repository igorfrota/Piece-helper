$was = Stop-SosVM $VMName
Get-VMGpuPartitionAdapter -VMName $VMName -EA SilentlyContinue | Remove-VMGpuPartitionAdapter
'Placa removida da VM.'
if ($PrevCheckpoint) {
  Set-VM -Name $VMName -CheckpointType $PrevCheckpoint -AutomaticCheckpointsEnabled ([bool]::Parse($PrevAuto)) -AutomaticStopAction $PrevStop
  'Pontos de verificacao voltaram a ser como antes.'
}
if ($was) { 'Ligando a VM de novo...'; Start-VM -Name $VMName }
