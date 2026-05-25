import { useEffect, useState } from "react";


import { db } from "./firebase";

import { ref, onValue } from "firebase/database";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend,
} from "chart.js";

import { Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend
);

function App() {
  const LOGS_PER_PAGE = 10;

  const [logs, setLogs] = useState([]);

  const [latest, setLatest] = useState(null);

  const [selectedFilter, setSelectedFilter] = useState("1H");

  const [startDate, setStartDate] = useState("");

  const [endDate, setEndDate] = useState("");

  const [currentPage, setCurrentPage] = useState(1);

  const [isOnline, setIsOnline] = useState(false);

  const [loading, setLoading] = useState(true);

  const [loadingProgress, setLoadingProgress] = useState(0);

  const [loadingText, setLoadingText] = useState("Initializing...");

  const [showAllMetrics, setShowAllMetrics] = useState(false);

  // =========================================
  // FETCH FIREBASE DATA
  // =========================================
  useEffect(() => {
    const logsRef = ref(db, "energy_logs/device_001");

    // STAGE 1
    setLoadingProgress(10);
    setLoadingText("Connecting to Firebase...");

    const unsubscribe = onValue(logsRef, (snapshot) => {
      // STAGE 2
      setLoadingProgress(35);
      setLoadingText("Fetching telemetry...");

      const data = snapshot.val();

      if (!data) {
        setLoadingProgress(100);

        setLoading(false);

        return;
      }

      // STAGE 3
      setLoadingProgress(60);
      setLoadingText("Processing records...");

      const parsedLogs = Object.entries(data)
        .map(([key, value]) => ({
          id: key,
          ...value,
        }))
        .sort((a, b) => b.timestamp - a.timestamp);

      // STAGE 4
      setLoadingProgress(85);
      setLoadingText("Generating analytics...");

      setLogs(parsedLogs);

      setLatest(parsedLogs[0]);

      const latestTimestamp = parsedLogs[0]?.timestamp || 0;

      const currentTimestamp = Math.floor(Date.now() / 1000);

      const diff = currentTimestamp - latestTimestamp;

      setIsOnline(diff <= 80);

      // FINAL STAGE
      setLoadingProgress(100);
      setLoadingText("Synchronization complete");

      setTimeout(() => {
        setLoading(false);
      }, 400);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedFilter, startDate, endDate]);

  // =========================================
  // FILTER LOGS
  // =========================================
  const now = Math.floor(Date.now() / 1000);

  let filteredLogs = [...logs];

  if (selectedFilter === "1H") {
    filteredLogs = logs.filter((log) => log.timestamp >= now - 3600);
  }

  if (selectedFilter === "6H") {
    filteredLogs = logs.filter((log) => log.timestamp >= now - 6 * 3600);
  }

  if (selectedFilter === "1D") {
    filteredLogs = logs.filter((log) => log.timestamp >= now - 86400);
  }

  if (selectedFilter === "1M") {
    filteredLogs = logs.filter((log) => log.timestamp >= now - 30 * 86400);
  }

  if (selectedFilter === "CUSTOM" && startDate && endDate) {
    const start = new Date(startDate).getTime() / 1000;

    const end = new Date(endDate).getTime() / 1000 + 86400;

    filteredLogs = logs.filter(
      (log) => log.timestamp >= start && log.timestamp <= end
    );
  }

  // =========================================

  // PAGINATION

  // =========================================

  const totalPages = Math.ceil(filteredLogs.length / LOGS_PER_PAGE);

  const startIndex = (currentPage - 1) * LOGS_PER_PAGE;

  const endIndex = startIndex + LOGS_PER_PAGE;

  const paginatedLogs = filteredLogs.slice(
    startIndex,

    endIndex
  );

  // =========================================
  // CHART BUCKETS
  // =========================================
  let bucketSize = 60;
  let bucketCount = 60;

  if (selectedFilter === "1H") {
    bucketSize = 60;
    bucketCount = 60;
  }

  if (selectedFilter === "6H") {
    bucketSize = 360;
    bucketCount = 60;
  }

  if (selectedFilter === "1D") {
    bucketSize = 1440;
    bucketCount = 60;
  }

  if (selectedFilter === "1M") {
    bucketSize = 43200;
    bucketCount = 60;
  }

  if (selectedFilter === "CUSTOM" && startDate && endDate) {
    const start = Math.floor(new Date(startDate).getTime() / 1000);

    const end = Math.floor(new Date(endDate).getTime() / 1000);

    const totalSeconds = end - start;

    bucketCount = 60;

    bucketSize = Math.floor(totalSeconds / bucketCount);
  }

  // =========================================
  // GENERATE EMPTY BUCKETS
  // =========================================
  const chartBuckets = [];

  const chartStart = now - bucketSize * bucketCount;

  for (let i = 0; i < bucketCount; i++) {
    const bucketTimestamp = chartStart + i * bucketSize;

    chartBuckets.push({
      timestamp: bucketTimestamp,
      power: 0,
      energy: 0,
      count: 0,
    });
  }

  // =========================================
  // FILL BUCKETS
  // =========================================
  filteredLogs.forEach((log) => {
    const index = Math.floor((log.timestamp - chartStart) / bucketSize);

    if (index >= 0 && index < chartBuckets.length) {
      chartBuckets[index].power += log.avg_power;

      chartBuckets[index].energy += log.energy_wh;

      chartBuckets[index].count += 1;
    }
  });

  // =========================================
  // AVERAGE POWER
  // =========================================
  chartBuckets.forEach((bucket) => {
    if (bucket.count > 0) {
      bucket.power = bucket.power / bucket.count;
    }
  });

  // =========================================
  // CHART LABELS
  // =========================================
  const chartLabels = chartBuckets.map((bucket) => {
    const date = new Date(bucket.timestamp * 1000);

    if (selectedFilter === "1H" || selectedFilter === "6H") {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    if (selectedFilter === "1D") {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
      });
    }

    return date.toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  });

  // =========================================
  // DATASETS
  // =========================================
  const chartPower = chartBuckets.map((bucket) => bucket.power);

  const chartEnergy = chartBuckets.map((bucket) => bucket.energy);

  // =========================================
  // CHART DATA
  // =========================================
  const chartData = {
    labels: chartLabels,

    datasets: [
      {
        label: "Energy (Wh)",

        data: chartEnergy,

        tension: 0.4,

        fill: true,

        borderWidth: 3,

        borderColor: "#6b7280",

        backgroundColor: "rgba(107,114,128,0.15)",

        pointRadius: 2,

        yAxisID: "y",
      },

      {
        label: "Power (W)",

        data: chartPower,

        tension: 0.4,

        fill: false,

        borderWidth: 3,

        borderColor: "#2563eb",

        backgroundColor: "rgba(37,99,235,0.1)",

        pointRadius: 2,

        yAxisID: "y1",
      },
    ],
  };

  // =========================================
  // CHART OPTIONS
  // =========================================
  const chartOptions = {
    responsive: true,

    maintainAspectRatio: false,

    interaction: {
      mode: "index",
      intersect: false,
    },

    plugins: {
      legend: {
        display: true,
        position: "top",
      },

      tooltip: {
        enabled: true,

        mode: "index",

        intersect: false,

        callbacks: {
          label: function (context) {
            const label = context.dataset.label;

            const value = context.parsed.y;

            if (label === "Energy (Wh)") {
              return `${label}: ${value.toFixed(3)} Wh`;
            }

            return `${label}: ${value.toFixed(2)} W`;
          },
        },
      },
    },

    scales: {
      x: {
        title: {
          display: true,
          text: "Time",
        },

        grid: {
          display: false,
        },
      },

      // LEFT AXIS
      y: {
        beginAtZero: true,

        position: "left",

        title: {
          display: true,
          text: "Energy (Wh)",
        },

        ticks: {
          color: "#6b7280",
        },

        grid: {
          color: "rgba(107,114,128,0.1)",
        },
      },

      // RIGHT AXIS
      y1: {
        beginAtZero: true,

        position: "right",

        title: {
          display: true,
          text: "Power (W)",
        },

        ticks: {
          color: "#2563eb",
        },

        grid: {
          drawOnChartArea: false,
        },
      },
    },
  };
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="w-full max-w-xl px-8">
          {/* LOGO */}
          <div className="flex flex-col items-center">
            <div className="w-28 h-28 rounded-[2rem] bg-white shadow-sm border border-neutral-200 flex items-center justify-center mb-8">
              <svg width="56" height="56" viewBox="0 0 120 120" fill="none">
                <path
                  d="M18 72C30 34 52 32 60 60C68 88 90 86 102 48"
                  stroke="black"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h1 className="text-6xl font-bold tracking-tight">Zen</h1>

            <p className="text-neutral-500 text-lg mt-3">
              Realtime Energy Telemetry Dashboard
            </p>
          </div>

          {/* STATUS */}
          <div className="mt-14 text-center">
            <p className="text-lg font-medium">{loadingText}</p>

            <p className="text-neutral-500 mt-2">
              Syncing realtime telemetry from Firebase RTDB
            </p>
          </div>

          {/* PROGRESS */}
          <div className="mt-10">
            <div className="w-full h-3 bg-neutral-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-black rounded-full transition-all duration-500"
                style={{
                  width: `${loadingProgress}%`,
                }}
              />
            </div>

            <div className="flex items-center justify-between mt-3">
              <p className="text-neutral-500 text-sm">Loading telemetry</p>

              <p className="font-medium">{loadingProgress}%</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-2 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* HEADER */}

        <header className="flex items-start justify-between mb-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="w-full sm:w-auto flex items-center gap-3 bg-white border border-neutral-200 px-5 py-3 rounded-2xl shadow-sm">
              <div
                className={`w-3 h-3 rounded-full ${
                  isOnline ? "bg-green-500 animate-pulse" : "bg-red-500"
                }`}
              />

              <div>
                <p className="text-sm font-medium">
                  {isOnline ? "Device Active" : "Device Offline"}
                </p>

                <p className="text-xs text-neutral-500 mt-1">
                  {latest
                    ? `Last update: ${new Date(
                        latest.timestamp * 1000
                      ).toLocaleTimeString()}`
                    : "No telemetry"}
                </p>
              </div>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-neutral-200 flex items-center justify-center self-start">
              <svg width="34" height="34" viewBox="0 0 120 120" fill="none">
                <path
                  d="M18 72C30 34 52 32 60 60C68 88 90 86 102 48"
                  stroke="black"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Zen</h1>

              <p className="text-neutral-500 text-sm mt-1">
                Realtime Energy Telemetry Dashboard
              </p>
            </div>
          </div>
        </header>

        {/* METRICS */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
          <MetricCard
            title="Current Power"
            value={latest ? `${latest.avg_power.toFixed(2)} W` : "--"}
            subtitle="Live - Average (Last Minute)"
          />

          <MetricCard
            title="Voltage"
            value={latest ? `${latest.avg_voltage.toFixed(2)} V` : "--"}
            subtitle="Live - Average (Last Minute)"
          />

          <MetricCard
            title="Current"
            value={latest ? `${latest.avg_current.toFixed(2)} A` : "--"}
            subtitle="Live - Average (Last Minute)"
          />

          <MetricCard
            title="Energy"
            value={latest ? `${latest.energy_wh.toFixed(3)} Wh` : "--"}
            subtitle="Live (Last Minute)"
          />
        </section>
        {/* RANGE AVERAGES */}
        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
          <MetricCard
            title="Avg Power"
            value={(() => {
              const validLogs = filteredLogs.filter(
                (log) => log.avg_power !== 0
              );

              if (validLogs.length === 0) return "--";

              return `${(
                validLogs.reduce((sum, log) => sum + log.avg_power, 0) /
                validLogs.length
              ).toFixed(2)} W`;
            })()}
            subtitle={`Average • ${selectedFilter}`}
          />
          <MetricCard
            title="Avg Voltage"
            value={(() => {
              const validLogs = filteredLogs.filter(
                (log) => log.avg_voltage !== 0
              );

              if (validLogs.length === 0) return "--";

              return `${(
                validLogs.reduce((sum, log) => sum + log.avg_voltage, 0) /
                validLogs.length
              ).toFixed(2)} V`;
            })()}
            subtitle={`Average • ${selectedFilter}`}
          />

          <MetricCard
            title="Avg Current"
            value={(() => {
              const validLogs = filteredLogs.filter(
                (log) => log.avg_current !== 0
              );

              if (validLogs.length === 0) return "--";

              return `${(
                validLogs.reduce((sum, log) => sum + log.avg_current, 0) /
                validLogs.length
              ).toFixed(2)} A`;
            })()}
            subtitle={`Average • ${selectedFilter}`}
          />

          <MetricCard
            title="Total Energy"
            value={
              filteredLogs.length > 0
                ? `${filteredLogs
                    .reduce((sum, log) => sum + log.energy_wh, 0)
                    .toFixed(3)} Wh`
                : "--"
            }
            subtitle={`Accumulated • ${selectedFilter}`}
          />
        </section>
        {/* CHART */}
        <section className="bg-white border border-neutral-200 rounded-3xl p-3 sm:p-6 shadow-sm mb-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold">Energy Analytics</h2>

            <p className="text-neutral-500 text-sm mt-1">
              Realtime telemetry and historical trends
            </p>
          </div>

          {/* FILTERS */}
          <div className="flex flex-wrap gap-3 mb-6">
            <FilterButton
              label="1H"
              active={selectedFilter === "1H"}
              onClick={() => setSelectedFilter("1H")}
            />

            <FilterButton
              label="6H"
              active={selectedFilter === "6H"}
              onClick={() => setSelectedFilter("6H")}
            />

            <FilterButton
              label="1D"
              active={selectedFilter === "1D"}
              onClick={() => setSelectedFilter("1D")}
            />

            <FilterButton
              label="1M"
              active={selectedFilter === "1M"}
              onClick={() => setSelectedFilter("1M")}
            />

            <button
              onClick={() => setSelectedFilter("CUSTOM")}
              className={`px-4 py-2 rounded-xl text-sm transition border ${
                selectedFilter === "CUSTOM"
                  ? "bg-black text-white border-black"
                  : "bg-white border-neutral-200 hover:bg-neutral-100"
              }`}
            >
              Range
            </button>
          </div>

          {/* CUSTOM RANGE */}
          {selectedFilter === "CUSTOM" && (
            <div className="flex flex-wrap gap-4 mb-6">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-4 py-2 rounded-xl border border-neutral-200"
              />

              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-4 py-2 rounded-xl border border-neutral-200"
              />
            </div>
          )}

          <div className="h-[420px] rounded-2xl border border-neutral-100 bg-neutral-50 p-1 sm:p-4 overflow-hidden">
            <div className="w-full h-full">
              <Line data={chartData} options={chartOptions} />
            </div>
          </div>
        </section>

        {/* TABLE */}
        <section className="bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm">
          <h2 className="text-xl font-semibold mb-6">Recent Logs</h2>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left border-b border-neutral-200 text-sm text-neutral-500">
                  <th className="pb-4">Timestamp</th>

                  <th className="pb-4">Power</th>

                  <th className="pb-4">Voltage</th>

                  <th className="pb-4">Current</th>

                  <th className="pb-4">Energy</th>
                </tr>
              </thead>

              <tbody>
                {paginatedLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-neutral-100 text-sm"
                  >
                    <td className="py-4">
                      {new Date(log.timestamp * 1000).toLocaleString()}
                    </td>

                    <td className="py-4">{log.avg_power.toFixed(2)} W</td>

                    <td className="py-4">{log.avg_voltage.toFixed(2)} V</td>

                    <td className="py-4">{log.avg_current.toFixed(2)} A</td>

                    <td className="py-4">{log.energy_wh.toFixed(3)} Wh</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between mt-6">
              <p className="text-sm text-neutral-500">
                Showing {filteredLogs.length === 0 ? 0 : startIndex + 1}
                {" - "}
                {Math.min(endIndex, filteredLogs.length)} of{" "}
                {filteredLogs.length} logs
              </p>

              <div className="flex items-center gap-3">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                  className="px-4 py-2 rounded-xl border border-neutral-200 bg-white disabled:opacity-40"
                >
                  Prev
                </button>

                <div className="px-4 py-2 text-sm text-neutral-600">
                  Page {currentPage} / {totalPages === 0 ? 1 : totalPages}
                </div>

                <button
                  disabled={currentPage === totalPages || totalPages === 0}
                  onClick={() => setCurrentPage(currentPage + 1)}
                  className="px-4 py-2 rounded-xl border border-neutral-200 bg-white disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-3xl p-6 shadow-sm">
      <p className="text-sm text-neutral-500 mb-3">{title}</p>

      <h2 className="text-3xl font-semibold tracking-tight">{value}</h2>

      <p className="text-sm text-neutral-500 mt-2">{subtitle}</p>
    </div>
  );
}

function FilterButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm transition border ${
        active
          ? "bg-black text-white border-black"
          : "bg-white border-neutral-200 hover:bg-neutral-100"
      }`}
    >
      {label}
    </button>
  );
}

export default App;
