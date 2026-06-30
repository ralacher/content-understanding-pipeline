param location string = resourceGroup().location
param environmentName string = 'content-understanding-env'
param storageAccountName string
param cosmosAccountName string
param webAppName string
param containerAppName string = 'ffmpeg-worker'
param logAnalyticsName string = 'content-understanding-logs'
param applicationInsightsName string = 'content-understanding-ai'
param uploadContainerName string = 'incoming-avi'
param processedContainerName string = 'processed-mp4'
param queueName string = 'video-processing'
param cosmosDatabaseName string = 'content-understanding'
param cosmosContainerName string = 'media-records'
param contentUnderstandingAccountName string
param aiSearchServiceName string = 'content-understanding-search'
param aiSearchSku string = 'basic'
param webContainerImage string
param workerContainerImage string
param containerRegistryName string
param containerRegistryLoginServer string
param appTitle string = 'Content Understanding Hub'
param authClientId string = ''
@secure()
param authClientSecret string = ''
param authTenantId string = ''
@secure()
param authSessionSecret string = ''
param contentUnderstandingApiVersion string = '2026-05-01'
param contentUnderstandingAnalyzerId string = 'prebuilt-video'
param uploadWriteQueueMessage bool = false

var storageBlobDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
)
var cognitiveServicesUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'a97b65f3-24c7-4388-baec-2e87135dc908'
)
var storageQueueDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
)
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
var cosmosBuiltInDataContributorRoleDefinitionId = '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
var searchServiceContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7ca78c08-252a-4471-8644-bb5ff32d4ba0'
)
var searchIndexDataContributorRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '8ebe5a00-799e-43f5-93ac-243d3dce84a7'
)
var storageAccountUrl = 'https://${storage.name}.blob.${environment().suffixes.storage}'
var webAppBaseUrl = 'https://${webAppName}.${managedEnvironment.properties.defaultDomain}'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource uploadContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: uploadContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource processedContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: processedContainerName
  properties: {
    publicAccess: 'None'
  }
}

resource processingQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: queueName
}

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    publicNetworkAccess: 'Enabled'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    capabilities: []
  }
}

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
  }
}

resource cosmosContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDatabase
  name: cosmosContainerName
  properties: {
    resource: {
      id: cosmosContainerName
      partitionKey: {
        paths: ['/id']
        kind: 'Hash'
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
      }
    }
  }
}

resource contentUnderstanding 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: contentUnderstandingAccountName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    customSubDomainName: contentUnderstandingAccountName
    disableLocalAuth: true
  }
}

resource aiSearch 'Microsoft.Search/searchServices@2024-03-01-preview' = {
  name: aiSearchServiceName
  location: location
  sku: {
    name: aiSearchSku
  }
  properties: {
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource managedEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

resource webApp 'Microsoft.App/containerApps@2026-01-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8080
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'frontend-api'
          image: webContainerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'APP_BASE_URL', value: webAppBaseUrl }
            { name: 'NEXT_PUBLIC_APP_BASE_URL', value: webAppBaseUrl }
            { name: 'NEXT_PUBLIC_APP_TITLE', value: appTitle }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '8080' }
            { name: 'ENTRA_ID_CLIENT_ID', value: authClientId }
            { name: 'ENTRA_ID_CLIENT_SECRET', value: authClientSecret }
            { name: 'ENTRA_ID_TENANT_ID', value: authTenantId }
            { name: 'AUTH_SESSION_SECRET', value: authSessionSecret }
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storageAccountUrl }
            { name: 'AZURE_STORAGE_UPLOAD_CONTAINER', value: uploadContainerName }
            { name: 'AZURE_STORAGE_PROCESSED_CONTAINER', value: processedContainerName }
            { name: 'AZURE_STORAGE_QUEUE_NAME', value: queueName }
            { name: 'AZURE_COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'AZURE_COSMOS_DATABASE', value: cosmosDatabaseName }
            { name: 'AZURE_COSMOS_CONTAINER', value: cosmosContainerName }
            { name: 'CONTENT_UNDERSTANDING_ENDPOINT', value: contentUnderstanding.properties.endpoint }
            { name: 'CONTENT_UNDERSTANDING_API_VERSION', value: contentUnderstandingApiVersion }
            { name: 'CONTENT_UNDERSTANDING_ANALYZER_ID', value: contentUnderstandingAnalyzerId }
            { name: 'AZURE_AI_SEARCH_ENDPOINT', value: 'https://${aiSearch.name}.search.windows.net' }
            { name: 'AZURE_AI_SEARCH_INDEX_NAME', value: 'content-understanding-assets' }
            { name: 'AZURE_AI_SEARCH_API_VERSION', value: '2024-07-01' }
            { name: 'AZURE_FOUNDRY_ENDPOINT', value: contentUnderstanding.properties.endpoint }
            { name: 'AZURE_FOUNDRY_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
            { name: 'UPLOAD_WRITE_QUEUE_MESSAGE', value: string(uploadWriteQueueMessage) }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsights.properties.ConnectionString }
            { name: 'APPLICATIONINSIGHTS_ROLE_NAME', value: 'frontend-api' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2026-01-01' = {
  name: containerAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: managedEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: containerRegistryLoginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'ffmpeg-worker'
          image: workerContainerImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: storageAccountUrl }
            { name: 'AZURE_STORAGE_UPLOAD_CONTAINER', value: uploadContainerName }
            { name: 'AZURE_STORAGE_PROCESSED_CONTAINER', value: processedContainerName }
            { name: 'AZURE_STORAGE_QUEUE_NAME', value: queueName }
            { name: 'AZURE_COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
            { name: 'AZURE_COSMOS_DATABASE', value: cosmosDatabaseName }
            { name: 'AZURE_COSMOS_CONTAINER', value: cosmosContainerName }
            { name: 'CONTENT_UNDERSTANDING_ENDPOINT', value: contentUnderstanding.properties.endpoint }
            { name: 'CONTENT_UNDERSTANDING_API_VERSION', value: contentUnderstandingApiVersion }
            { name: 'CONTENT_UNDERSTANDING_ANALYZER_ID', value: contentUnderstandingAnalyzerId }
            { name: 'AZURE_AI_SEARCH_ENDPOINT', value: 'https://${aiSearch.name}.search.windows.net' }
            { name: 'AZURE_AI_SEARCH_INDEX_NAME', value: 'content-understanding-assets' }
            { name: 'AZURE_AI_SEARCH_API_VERSION', value: '2024-07-01' }
            { name: 'AZURE_FOUNDRY_ENDPOINT', value: contentUnderstanding.properties.endpoint }
            { name: 'AZURE_FOUNDRY_EMBEDDING_DEPLOYMENT', value: 'text-embedding-3-small' }
            { name: 'APP_BASE_URL', value: webAppBaseUrl }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: applicationInsights.properties.ConnectionString }
            { name: 'APPLICATIONINSIGHTS_ROLE_NAME', value: 'worker' }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 4
        rules: [
          {
            name: 'queue-scale'
            #disable-next-line BCP037 // Azure queue scale rules support managed identity; the current Bicep type definition is stale.
            custom: {
              type: 'azure-queue'
              identity: 'system'
              metadata: {
                accountName: storage.name
                queueName: queueName
                queueLength: '1'
              }
            }
          }
        ]
      }
    }
  }
  dependsOn: [
    
  ]
}

resource workerAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, containerApp.name, acrPullRoleDefinitionId)
  scope: containerRegistry
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, webApp.name, acrPullRoleDefinitionId)
  scope: containerRegistry
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, containerApp.name, storageBlobDataContributorRoleDefinitionId, 'blob')
  scope: storage
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: storageBlobDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerQueueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, containerApp.name, storageQueueDataContributorRoleDefinitionId, 'queue')
  scope: storage
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webBlobDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webApp.name, storageBlobDataContributorRoleDefinitionId, 'blob')
  scope: storage
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: storageBlobDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webQueueDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, webApp.name, storageQueueDataContributorRoleDefinitionId, 'queue')
  scope: storage
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: storageQueueDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerCosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, containerApp.name, cosmosBuiltInDataContributorRoleDefinitionId)
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: cosmosBuiltInDataContributorRoleDefinitionId
    scope: cosmos.id
  }
}

resource webCosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, webApp.name, cosmosBuiltInDataContributorRoleDefinitionId)
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: cosmosBuiltInDataContributorRoleDefinitionId
    scope: cosmos.id
  }
}

resource workerContentUnderstandingUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(contentUnderstanding.id, containerApp.name, cognitiveServicesUserRoleDefinitionId)
  scope: contentUnderstanding
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: cognitiveServicesUserRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webContentUnderstandingUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(contentUnderstanding.id, webApp.name, cognitiveServicesUserRoleDefinitionId)
  scope: contentUnderstanding
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: cognitiveServicesUserRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerSearchServiceContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiSearch.id, containerApp.name, searchServiceContributorRoleDefinitionId)
  scope: aiSearch
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: searchServiceContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource workerSearchIndexDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiSearch.id, containerApp.name, searchIndexDataContributorRoleDefinitionId)
  scope: aiSearch
  properties: {
    principalId: containerApp.identity.principalId
    roleDefinitionId: searchIndexDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webSearchServiceContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiSearch.id, webApp.name, searchServiceContributorRoleDefinitionId)
  scope: aiSearch
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: searchServiceContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource webSearchIndexDataContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiSearch.id, webApp.name, searchIndexDataContributorRoleDefinitionId)
  scope: aiSearch
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: searchIndexDataContributorRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource systemTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: '${storage.name}-blob-events'
  location: location
  properties: {
    source: storage.id
    topicType: 'Microsoft.Storage.StorageAccounts'
  }
}

resource blobCreatedSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: systemTopic
  name: 'blob-created-to-queue'
  properties: {
    destination: {
      endpointType: 'StorageQueue'
      properties: {
        resourceId: storage.id
        queueName: queueName
      }
    }
    filter: {
      includedEventTypes: [
        'Microsoft.Storage.BlobCreated'
      ]
      subjectBeginsWith: '/blobServices/default/containers/${uploadContainerName}/blobs/'
    }
    eventDeliverySchema: 'EventGridSchema'
    retryPolicy: {
      maxDeliveryAttempts: 5
      eventTimeToLiveInMinutes: 1440
    }
  }
}

output storageAccountUrl string = storageAccountUrl
output cosmosEndpoint string = cosmos.properties.documentEndpoint
output contentUnderstandingEndpoint string = contentUnderstanding.properties.endpoint
output containerAppIdentityPrincipalId string = containerApp.identity.principalId
output webAppUrl string = webAppBaseUrl
output webAppIdentityPrincipalId string = webApp.identity.principalId
