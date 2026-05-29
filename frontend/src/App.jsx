import React, { useEffect, useState } from "react";
import { useAuth } from "react-oidc-context";
import { API_BASE, COGNITO_DOMAIN, LOGOUT_URI, OIDC_CONFIG } from "./config";
import "./App.css";

function formatNumber(value, digits = 2) {
  return Number(value || 0).toFixed(digits);
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
  });
}

function buildTrendData(measurements) {
  const pointsByTimestamp = measurements.reduce((acc, item) => {
    const timestamp = item.timestamp;
    if (!timestamp) return acc;
    acc[timestamp] = (acc[timestamp] || 0) + (Number(item.kwh) || 0);
    return acc;
  }, {});

  return Object.entries(pointsByTimestamp)
    .sort(([left], [right]) => new Date(left) - new Date(right))
    .map(([timestamp, kwh]) => ({ timestamp, kwh }));
}

function buildDeviceTotals(measurements) {
  const totalsByDevice = measurements.reduce((acc, item) => {
    const deviceId = item.device_id || "Unknown";
    acc[deviceId] = (acc[deviceId] || 0) + (Number(item.kwh) || 0);
    return acc;
  }, {});

  return Object.entries(totalsByDevice)
    .map(([deviceId, kwh]) => ({ deviceId, kwh }))
    .sort((left, right) => right.kwh - left.kwh);
}

function EnergyTrendChart({ data }) {
  const width = 720;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 40, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visibleData = data.length > 96 ? data.slice(-96) : data;
  const maxKwh = Math.max(...visibleData.map((point) => point.kwh), 1);
  const minKwh = Math.min(...visibleData.map((point) => point.kwh), 0);
  const range = Math.max(maxKwh - minKwh, 1);

  const coordinates = visibleData.map((point, index) => {
    const x =
      padding.left +
      (visibleData.length === 1 ? chartWidth / 2 : (index / (visibleData.length - 1)) * chartWidth);
    const y = padding.top + chartHeight - ((point.kwh - minKwh) / range) * chartHeight;
    return { ...point, x, y };
  });
  const path = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
  const firstPoint = visibleData[0];
  const lastPoint = visibleData[visibleData.length - 1];

  if (visibleData.length === 0) {
    return <div className="empty-chart">No trend data available.</div>;
  }

  return (
    <div className="chart-viewport" role="img" aria-label="kWh trend over time">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} />
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
        />
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + chartHeight - ratio * chartHeight;
          const value = minKwh + ratio * range;
          return (
            <g key={ratio}>
              <line
                className="grid-line"
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
              />
              <text x={padding.left - 10} y={y + 4} textAnchor="end">
                {formatNumber(value, 1)}
              </text>
            </g>
          );
        })}
        <path
          className="trend-area"
          d={`${path} L ${coordinates.at(-1).x} ${height - padding.bottom} L ${coordinates[0].x} ${height - padding.bottom} Z`}
        />
        <path className="trend-line" d={path} />
        {coordinates.map((point, index) =>
          index % Math.ceil(coordinates.length / 12) === 0 || index === coordinates.length - 1 ? (
            <circle key={point.timestamp} cx={point.x} cy={point.y} r="3.5">
              <title>{`${formatShortDate(point.timestamp)}: ${formatNumber(point.kwh, 3)} kWh`}</title>
            </circle>
          ) : null
        )}
        <text x={padding.left} y={height - 12}>
          {formatShortDate(firstPoint.timestamp)}
        </text>
        <text x={width - padding.right} y={height - 12} textAnchor="end">
          {formatShortDate(lastPoint.timestamp)}
        </text>
      </svg>
    </div>
  );
}

function DeviceTotalsChart({ data }) {
  const width = 720;
  const height = 260;
  const padding = { top: 18, right: 24, bottom: 48, left: 54 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const visibleData = data.slice(0, 10);
  const maxKwh = Math.max(...visibleData.map((item) => item.kwh), 1);
  const gap = 10;
  const barWidth = Math.max((chartWidth - gap * (visibleData.length - 1)) / visibleData.length, 24);

  if (visibleData.length === 0) {
    return <div className="empty-chart">No device totals available.</div>;
  }

  return (
    <div className="chart-viewport" role="img" aria-label="Total kWh by visible device">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} />
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
        />
        {[0, 0.5, 1].map((ratio) => {
          const y = padding.top + chartHeight - ratio * chartHeight;
          return (
            <g key={ratio}>
              <line
                className="grid-line"
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
              />
              <text x={padding.left - 10} y={y + 4} textAnchor="end">
                {formatNumber(maxKwh * ratio, 0)}
              </text>
            </g>
          );
        })}
        {visibleData.map((item, index) => {
          const x = padding.left + index * (barWidth + gap);
          const barHeight = (item.kwh / maxKwh) * chartHeight;
          const y = padding.top + chartHeight - barHeight;
          return (
            <g key={item.deviceId}>
              <rect className="bar-fill" x={x} y={y} width={barWidth} height={barHeight} rx="5">
                <title>{`${item.deviceId}: ${formatNumber(item.kwh, 2)} kWh`}</title>
              </rect>
              <text x={x + barWidth / 2} y={height - 20} textAnchor="middle">
                {item.deviceId}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function App() {
  const auth = useAuth();

  const [profile, setProfile] = useState(null);
  const [dataResponse, setDataResponse] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);

  const idToken = auth.user?.id_token;
  const measurements = dataResponse?.data || [];
  const visibleDevices = dataResponse?.devices || [];
  const totalKwh = measurements.reduce((sum, item) => sum + (Number(item.kwh) || 0), 0);
  const averageKwh = measurements.length > 0 ? totalKwh / measurements.length : 0;
  const trendData = buildTrendData(measurements);
  const deviceTotals = buildDeviceTotals(measurements);
  const filterScope =
    dataResponse?.filter?.scope === "all_devices" ? "Admin: all devices" : "User: assigned devices";

  useEffect(() => {
    if (!idToken) {
      setProfile(null);
      setDataResponse(null);
      return;
    }

    setError(null);

    setLoadingProfile(true);
    fetch(`${API_BASE}/api/profile`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Error calling /api/profile");
        return data;
      })
      .then((data) => setProfile(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingProfile(false));

    setLoadingData(true);
    fetch(`${API_BASE}/api/data`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Error calling /api/data");
        return data;
      })
      .then((data) => setDataResponse(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingData(false));
  }, [idToken]);

  const signOutRedirect = () => {
    const clientId = OIDC_CONFIG.client_id;
    auth.removeUser();
    window.location.href =
      `${COGNITO_DOMAIN}/logout?client_id=${clientId}` +
      `&logout_uri=${encodeURIComponent(LOGOUT_URI)}`;
  };

  const copyToken = async () => {
    if (!idToken) return;
    try {
      await navigator.clipboard.writeText(idToken);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (copyError) {
      setError("Unable to copy token to clipboard.");
    }
  };

  if (auth.isLoading) {
    return (
      <div className="app-shell">
        <div className="status-panel">Loading authentication...</div>
      </div>
    );
  }

  if (auth.error) {
    return (
      <div className="app-shell">
        <div className="status-panel status-panel-error">
          Encountering error... {auth.error.message}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="app">
        <header className="hero">
          <p className="hero-kicker">Azure Blob + Cognito</p>
          <h1>Energy Measurements</h1>
          <p className="hero-subtitle">
            Device-level energy data secured by Cognito groups and filtered by the custom deviceId
            claim.
          </p>
        </header>

        {error && (
          <div className="alert">
            <strong>Error:</strong> {error}
          </div>
        )}

        <section className="card status-card">
          {auth.isAuthenticated ? (
            <>
              <p className="status-line">
                <span className="status-dot status-dot-online" />
                Logged in as <strong>{auth.user?.profile?.email || "(no email claim)"}</strong>
              </p>
              <button className="btn btn-secondary" onClick={signOutRedirect}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="status-line">
                <span className="status-dot" />
                Not logged in
              </p>
              <button className="btn" onClick={() => auth.signinRedirect()}>
                Sign in
              </button>
            </>
          )}
        </section>

        {auth.isAuthenticated && (
          <div className="grid">
            <section className="card">
              <div className="section-head">
                <h2>Session</h2>
                <div className="actions">
                  <button
                    className="btn btn-small btn-ghost"
                    onClick={() => setShowToken((current) => !current)}
                  >
                    {showToken ? "Hide" : "Show"}
                  </button>
                  <button className="btn btn-small btn-ghost" onClick={copyToken}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <dl className="profile-list">
                <div>
                  <dt>Role</dt>
                  <dd>{loadingProfile ? "..." : profile?.role || "unknown"}</dd>
                </div>
                <div>
                  <dt>Device claim</dt>
                  <dd>{loadingProfile ? "..." : profile?.device_id || "Admin / not assigned"}</dd>
                </div>
              </dl>
              <pre className="code-block">ID Token: {showToken ? idToken : "hidden"}</pre>
            </section>

            <section className="card">
              <h2>Dataset</h2>
              {loadingData ? (
                <p className="muted">Loading dataset...</p>
              ) : dataResponse ? (
                <div className="metric-grid">
                  <div className="metric">
                    <span>Rows</span>
                    <strong>{dataResponse.returned_count}</strong>
                    <small>{dataResponse.total_count} total</small>
                  </div>
                  <div className="metric">
                    <span>Devices</span>
                    <strong>{visibleDevices.length}</strong>
                    <small>{visibleDevices.join(", ") || "none"}</small>
                  </div>
                  <div className="metric">
                    <span>Average kWh</span>
                    <strong>{formatNumber(averageKwh, 3)}</strong>
                    <small>{formatNumber(totalKwh, 2)} kWh shown</small>
                  </div>
                  <div className="metric metric-wide">
                    <span>Filter scope</span>
                    <strong>
                      {dataResponse.filter?.scope === "all_devices"
                        ? "All devices"
                        : "Assigned only"}
                    </strong>
                    <small>
                      {dataResponse.filter?.applied_device_ids?.length
                        ? dataResponse.filter.applied_device_ids.join(", ")
                        : "Admin group sees every device"}
                    </small>
                  </div>
                </div>
              ) : (
                <p className="muted">No dataset loaded yet.</p>
              )}
            </section>

            <section className="card card-wide charts-card">
              <div className="section-head">
                <h2>Energy Analytics</h2>
                {dataResponse && <span className="scope-pill">{filterScope}</span>}
              </div>
              {loadingData ? (
                <p className="muted chart-loading">Loading charts...</p>
              ) : measurements.length > 0 ? (
                <div className="charts-grid">
                  <article className="chart-panel">
                    <div className="chart-head">
                      <h3>kWh Trend</h3>
                      <span>
                        {trendData.length > 96
                          ? "Last 96 timestamps"
                          : `${trendData.length} timestamps`}
                      </span>
                    </div>
                    <EnergyTrendChart data={trendData} />
                  </article>
                  <article className="chart-panel">
                    <div className="chart-head">
                      <h3>Total kWh by Device</h3>
                      <span>
                        {deviceTotals.length > 10
                          ? "Top 10 devices"
                          : `${deviceTotals.length} devices`}
                      </span>
                    </div>
                    <DeviceTotalsChart data={deviceTotals} />
                  </article>
                </div>
              ) : (
                <p className="muted chart-loading">No measurements available for charts.</p>
              )}
            </section>

            <section className="card card-wide">
              <div className="section-head">
                <h2>Devices and Measurements</h2>
                {dataResponse?.source && (
                  <span className="source-pill">
                    {dataResponse.source.container}/{dataResponse.source.blob}
                  </span>
                )}
              </div>
              {loadingData ? (
                <p className="muted">Loading data...</p>
              ) : measurements.length > 0 ? (
                <div className="table-wrap">
                  <table className="measurements-table">
                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Timestamp</th>
                        <th>Location</th>
                        <th className="number-cell">kWh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {measurements.map((item, index) => (
                        <tr key={`${item.device_id}-${item.timestamp}-${index}`}>
                          <td>
                            <span className="device-badge">{item.device_id}</span>
                          </td>
                          <td>{item.timestamp}</td>
                          <td>{item.location}</td>
                          <td className="number-cell">{formatNumber(item.kwh, 3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">No measurements available for this account.</p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
