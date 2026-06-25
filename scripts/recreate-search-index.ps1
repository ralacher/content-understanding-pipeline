param(
  [string]$ResourceGroup = "content-understanding-test",
  [string]$SearchServiceName = "cu-68229f9af3-search",
  [string]$IndexName = "content-understanding-assets",
  [int]$VectorDimensions = 1536,
  [string]$BackupPath = ".search-docs-backup.json"
)

$ErrorActionPreference = "Stop"

$endpoint = "https://$SearchServiceName.search.windows.net"
$key = az search admin-key show --resource-group $ResourceGroup --service-name $SearchServiceName --query primaryKey -o tsv
if (-not $key) { throw "Unable to retrieve Search admin key." }

$headers = @{ "api-key" = $key; "Content-Type" = "application/json" }

function Get-ErrorResponseText([System.Management.Automation.ErrorRecord]$errorRecord) {
  if (-not $errorRecord) { return $null }

  if ($errorRecord.ErrorDetails -and $errorRecord.ErrorDetails.Message) {
    return $errorRecord.ErrorDetails.Message
  }

  $response = $errorRecord.Exception.Response
  if (-not $response) { return $null }

  if ($response -is [System.Net.Http.HttpResponseMessage]) {
    try {
      return $response.Content.ReadAsStringAsync().Result
    } catch {
      return $null
    }
  }

  if ($response.PSObject.Methods.Name -contains "GetResponseStream") {
    try {
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      return $reader.ReadToEnd()
    } catch {
      return $null
    }
  }

  return $null
}

Write-Output "Exporting existing docs from index '$IndexName'..."
$searchPayload = @{ search = "*"; top = 1000; select = "*" } | ConvertTo-Json -Depth 20
$docs = @()
try {
  $searchResponse = Invoke-RestMethod -Method Post -Uri "$endpoint/indexes/${IndexName}/docs/search?api-version=2024-07-01" -Headers $headers -Body $searchPayload
  $docs = @($searchResponse.value)
} catch {
  $errorBody = Get-ErrorResponseText $_
  if ($errorBody -and $errorBody -match "was not found") {
    Write-Output "Index not found for export."
    if (Test-Path $BackupPath) {
      Write-Output "Loading docs from backup file '$BackupPath'..."
      $backup = Get-Content $BackupPath -Raw | ConvertFrom-Json
      $docs = @($backup)
    }
  } else {
    if ($errorBody) {
      Write-Output $errorBody
    }
    throw
  }
}

if ($docs.Count -eq 0 -and (Test-Path $BackupPath)) {
  Write-Output "No docs exported from source index. Loading docs from backup file '$BackupPath'..."
  $backup = Get-Content $BackupPath -Raw | ConvertFrom-Json
  $docs = @($backup)
}

Write-Output "Exported $($docs.Count) docs."

Write-Output "Deleting index '$IndexName' (if exists)..."
try {
  Invoke-RestMethod -Method Delete -Uri "$endpoint/indexes/${IndexName}?api-version=2024-07-01" -Headers $headers | Out-Null
} catch {
  Write-Output "Index delete skipped: $($_.Exception.Message)"
  $errorBody = Get-ErrorResponseText $_
  if ($errorBody) {
    Write-Output $errorBody
  }
}

Write-Output "Creating index '$IndexName' with English analyzers..."
$indexDef = @{
  name = $IndexName
  fields = @(
    @{ name = "id"; type = "Edm.String"; key = $true; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "type"; type = "Edm.String"; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "fileName"; type = "Edm.String"; searchable = $true; filterable = $true; sortable = $true; analyzer = "en.microsoft" },
    @{ name = "status"; type = "Edm.String"; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "summary"; type = "Edm.String"; searchable = $true; filterable = $false; sortable = $false; analyzer = "en.microsoft" },
    @{ name = "tags"; type = "Collection(Edm.String)"; searchable = $true; filterable = $true; facetable = $true },
    @{ name = "unsafeBehaviorsText"; type = "Edm.String"; searchable = $true; filterable = $false; sortable = $false; analyzer = "en.microsoft" },
    @{ name = "numberOfPeople"; type = "Edm.Int32"; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "objectDataText"; type = "Edm.String"; searchable = $true; filterable = $false; sortable = $false; analyzer = "en.microsoft" },
    @{ name = "trainPassingsText"; type = "Edm.String"; searchable = $true; filterable = $false; sortable = $false; analyzer = "en.microsoft" },
    @{ name = "location"; type = "Edm.String"; searchable = $true; filterable = $true; sortable = $true; analyzer = "en.microsoft" },
    @{ name = "searchableText"; type = "Edm.String"; searchable = $true; filterable = $false; sortable = $false; analyzer = "en.microsoft" },
    @{ name = "contentVector"; type = "Collection(Edm.Single)"; searchable = $true; filterable = $false; sortable = $false; facetable = $false; dimensions = $VectorDimensions; vectorSearchProfile = "content-vector-profile" },
    @{ name = "createdAt"; type = "Edm.DateTimeOffset"; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "updatedAt"; type = "Edm.DateTimeOffset"; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "indexedAt"; type = "Edm.DateTimeOffset"; searchable = $false; filterable = $true; sortable = $true },
    @{ name = "uploadedByName"; type = "Edm.String"; searchable = $true; filterable = $true; sortable = $true; analyzer = "en.microsoft" }
  )
  vectorSearch = @{
    algorithms = @(
      @{ name = "content-hnsw"; kind = "hnsw"; hnswParameters = @{ metric = "cosine"; m = 4; efConstruction = 400; efSearch = 500 } }
    )
    profiles = @(
      @{ name = "content-vector-profile"; algorithm = "content-hnsw" }
    )
  }
}

$indexBody = $indexDef | ConvertTo-Json -Depth 50
try {
  Invoke-RestMethod -Method Put -Uri "$endpoint/indexes/${IndexName}?api-version=2024-07-01" -Headers $headers -Body $indexBody | Out-Null
} catch {
  $errorBody = Get-ErrorResponseText $_
  if ($errorBody) {
    Write-Output $errorBody
  }
  throw
}
Write-Output "Index created."

if ($docs.Count -eq 0) {
  Write-Output "No docs to restore. Done."
  exit 0
}

Write-Output "Restoring $($docs.Count) docs..."
$actions = @()
foreach ($doc in $docs) {
  $action = @{ "@search.action" = "mergeOrUpload"; id = $doc.id; type = $doc.type; fileName = $doc.fileName; status = $doc.status; summary = $doc.summary; unsafeBehaviorsText = $doc.unsafeBehaviorsText; numberOfPeople = $doc.numberOfPeople; objectDataText = $doc.objectDataText; trainPassingsText = $doc.trainPassingsText; location = $doc.location; searchableText = $doc.searchableText; createdAt = $doc.createdAt; updatedAt = $doc.updatedAt; indexedAt = $doc.indexedAt; uploadedByName = $doc.uploadedByName }
  if ($null -ne $doc.tags -and @($doc.tags).Count -gt 0) {
    $action.tags = $doc.tags
  }
  if ($null -ne $doc.contentVector -and @($doc.contentVector).Count -gt 0) {
    $action.contentVector = $doc.contentVector
  }
  $actions += $action
}

$uploadBody = @{ value = $actions } | ConvertTo-Json -Depth 100
$uploadResponse = Invoke-RestMethod -Method Post -Uri "$endpoint/indexes/${IndexName}/docs/index?api-version=2024-07-01" -Headers $headers -Body $uploadBody
$failed = @($uploadResponse.value | Where-Object { $_.status -ne $true })
if ($failed.Count -gt 0) {
  throw "Restore had $($failed.Count) failed docs."
}

Write-Output "Restore complete."
