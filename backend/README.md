# Backend (Azure Functions)

Minimal Node.js Azure Functions backend used by students to learn:

- JWT verification with AWS Cognito JWKs
- role-based authorization (`admin` / `user`)
- claim-based filtering (`custom:deviceId`, with `custom:device_id` kept as a fallback)
- Azure Blob Storage dataset reads using managed identity

## Endpoints

- `GET /`
- `GET /api/profile` (requires Bearer token)
- `GET /api/data` (requires Bearer token)

## Files

- `Root/index.js` -> health/root endpoint
- `Profile/index.js` -> returns resolved claims
- `Data/index.js` -> reads `energy_usage_large.csv` from the `datasets` blob container and filters rows by role/device
- `shared/auth.js` -> Cognito JWT validation + shared HTTP helpers
- `host.json` -> Azure Functions host configuration

## Dataset configuration

The deployed Function App is already wired by Terraform for managed identity access:

- `STORAGE_ACCOUNT_NAME=sttucnccdeviscbi29cz`
- `DATASETS_CONTAINER_NAME=datasets`
- `DATASET_BLOB_NAME=energy_usage_large.csv`

The managed identity client id is supplied through `AZURE_CLIENT_ID`, so
`DefaultAzureCredential` can authenticate to Blob Storage without keys.

## Local (Docker)

From repo root:

```bash
docker compose up --build backend
```

Test quickly:

```bash
curl http://localhost:3001/
curl -i http://localhost:3001/api/profile
```

## Logging

- Structured JSON logs with `event`, `status`, `durationMs`, and `correlationId`
- Correlation ID comes from `x-correlation-id`/`x-request-id` header or is auto-generated
- Response includes `x-correlation-id`
- Set `LOG_LEVEL` in env (`error`, `warn`, `info`, `debug`), default is `info`
