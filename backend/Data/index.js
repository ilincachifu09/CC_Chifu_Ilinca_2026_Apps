const {
  authenticate,
  jsonResponseWithCorrelation,
  normalizeError,
  preflightResponse,
} = require("../shared/auth");
const { emit, finishRequest, maskDeviceId, startRequest } = require("../shared/logging");
const { BlobServiceClient } = require("@azure/storage-blob");
const { DefaultAzureCredential } = require("@azure/identity");

const DEFAULT_DATASET_BLOB_NAME = "energy_usage_large.csv";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readDatasetCsv(blobName) {
  const accountName = requiredEnv("STORAGE_ACCOUNT_NAME");
  const containerName = requiredEnv("DATASETS_CONTAINER_NAME");

  const client = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential()
  );
  const containerClient = client.getContainerClient(containerName);
  const blobClient = containerClient.getBlobClient(blobName);
  const downloadResponse = await blobClient.download();

  const chunks = [];
  for await (const chunk of downloadResponse.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf-8");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseDatasetCsv(csv) {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = headers.reduce((item, header, index) => {
      item[header] = values[index] === undefined ? "" : values[index].trim();
      return item;
    }, {});

    return {
      device_id: row.device_id,
      timestamp: row.timestamp,
      kwh: Number(row.kwh),
      location: row.location,
    };
  });
}

function normalizeDeviceIds(deviceIdClaim) {
  if (!deviceIdClaim) {
    return [];
  }

  return String(deviceIdClaim)
    .split(/[,\s;]+/)
    .map((deviceId) => deviceId.trim())
    .filter(Boolean);
}

function getVisibleData(allData, role, deviceIdClaim) {
  const userDeviceIds = normalizeDeviceIds(deviceIdClaim);

  if (role === "admin") {
    return { visibleData: allData, userDeviceIds };
  }

  if (role === "user") {
    return {
      visibleData: allData.filter((item) => userDeviceIds.includes(item.device_id)),
      userDeviceIds,
    };
  }

  return { visibleData: [], userDeviceIds };
}

async function data(context, req) {
  const request = startRequest(context, req, "/api/data");

  if (req.method === "OPTIONS") {
    context.res = preflightResponse(request.correlationId);
    finishRequest(context, request, 204);
    return;
  }

  try {
    const auth = await authenticate(req);
    const { role, device_id } = auth.claims;
    const blobName = process.env.DATASET_BLOB_NAME || DEFAULT_DATASET_BLOB_NAME;
    const datasetCsv = await readDatasetCsv(blobName);
    const allData = parseDatasetCsv(datasetCsv);

    let visibleData;
    let userDeviceIds;

    if (role === "admin") {
      ({ visibleData, userDeviceIds } = getVisibleData(allData, role, device_id));
    } else if (role === "user") {
      ({ visibleData, userDeviceIds } = getVisibleData(allData, role, device_id));

      if (userDeviceIds.length === 0) {
        emit(context, "warn", "authz.denied", {
          correlationId: request.correlationId,
          path: "/api/data",
          code: "missing_device_id",
          role,
        });
        context.res = jsonResponseWithCorrelation(
          403,
          {
            error: "No device_id associated with this account",
          },
          request.correlationId
        );
        finishRequest(context, request, 403);
        return;
      }
    } else {
      emit(context, "warn", "authz.denied", {
        correlationId: request.correlationId,
        path: "/api/data",
        code: "unknown_role",
        role,
      });
      context.res = jsonResponseWithCorrelation(
        403,
        { error: "Insufficient permissions" },
        request.correlationId
      );
      finishRequest(context, request, 403);
      return;
    }

    emit(context, "info", "authz.allowed", {
      correlationId: request.correlationId,
      path: "/api/data",
      role,
      deviceIdMasked: maskDeviceId(device_id),
      sourceBlob: blobName,
      totalCount: allData.length,
      returnedCount: visibleData.length,
    });

    context.res = jsonResponseWithCorrelation(
      200,
      {
        role,
        device_id,
        filter: {
          scope: role === "admin" ? "all_devices" : "assigned_devices",
          applied_device_ids: role === "admin" ? [] : userDeviceIds,
        },
        source: {
          storageAccount: process.env.STORAGE_ACCOUNT_NAME,
          container: process.env.DATASETS_CONTAINER_NAME,
          blob: blobName,
        },
        total_count: allData.length,
        returned_count: visibleData.length,
        devices: [...new Set(visibleData.map((item) => item.device_id))].sort(),
        data: visibleData,
      },
      request.correlationId
    );
    finishRequest(context, request, 200);
  } catch (error) {
    const normalized = normalizeError(error);
    emit(context, normalized.status >= 500 ? "error" : "warn", "auth.failed", {
      correlationId: request.correlationId,
      path: "/api/data",
      code: normalized.code,
      reason: normalized.logMessage,
    });
    context.res = jsonResponseWithCorrelation(
      normalized.status,
      { error: normalized.clientMessage },
      request.correlationId
    );
    finishRequest(context, request, normalized.status);
  }
}

module.exports = data;
module.exports._private = {
  getVisibleData,
  normalizeDeviceIds,
  parseDatasetCsv,
};
