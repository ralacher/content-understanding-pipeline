# Content Understanding Analyzer Template

Use [infra/content-understanding-analyzer.portal.json](../infra/content-understanding-analyzer.portal.json) as the starting analyzer definition for manual creation in the Content Understanding portal.

This template matches the fields the app currently parses and displays:

- `summary`
- `unsafeBehaviors`
- `numberOfPeople`
- `objectData`
- `trainPassings`
- `location`

After creating or updating the analyzer in the portal, copy its analyzer URL and set `CONTENT_UNDERSTANDING_ANALYZER_URL` in the worker container app, or pass the same value through the Bicep `contentUnderstandingAnalyzerUrl` parameter for future deployments.