import { useEffect, useState, useRef } from "react";
import { db } from "./firebase";

import {
  ref,
  onValue,
  query,
  orderByChild,
  startAt,
  endAt,
} from "firebase/database";

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

import jsPDF from "jspdf";

import autoTable from "jspdf-autotable";

import writeXlsxFile from "write-excel-file";
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
  const [loadingText, setLoadingText] = useState("Initializing...");
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const [initialLoading, setInitialLoading] = useState(true);

  const [showAllMetrics, setShowAllMetrics] = useState(false);

  const [cached1DLogs, setCached1DLogs] = useState([]);

  const [exporting, setExporting] = useState(false);

  const [exportProgress, setExportProgress] = useState(0);

  const [exportReady, setExportReady] = useState(false);

  const [showExportOptions, setShowExportOptions] = useState(false);

  const [preparedExportData, setPreparedExportData] = useState([]);
  // =========================================
  // FETCH FIREBASE DATA
  // =========================================
  useEffect(() => {
    setExportReady(false);

    setExportProgress(0);

    setShowExportOptions(false);

    setPreparedExportData([]);
  }, [selectedFilter, startDate, endDate]);
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        exportMenuRef.current &&
        !exportMenuRef.current.contains(event.target)
      ) {
        setShowExportOptions(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);
  useEffect(() => {
    let unsubscribe = null;

    async function fetchLogs() {
      try {
        // =====================================
        // LOCAL FILTERS USING CACHE
        // =====================================

        if (
          ["1H", "6H", "1D"].includes(selectedFilter) &&
          cached1DLogs.length > 0
        ) {
          setLogs(cached1DLogs);

          setLoading(false);

          setLoadingProgress(100);

          setLoadingText("Realtime sync active");

          return;
        }

        if (!initialLoading) {
          setLoading(true);
        }

        setLoadingProgress(10);

        setLoadingText("Preparing query...");

        const currentNow = Math.floor(Date.now() / 1000);

        let startTimestamp = currentNow - 86400;

        let endTimestamp = currentNow;

        // =====================================
        // FILTER WINDOWS
        // =====================================

        switch (selectedFilter) {
          case "1H":
          case "6H":
          case "1D":
            startTimestamp = currentNow - 86400;
            break;

          case "1M":
            startTimestamp = currentNow - 30 * 86400;
            break;

          case "CUSTOM":
            if (startDate && endDate) {
              startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);

              endTimestamp =
                Math.floor(new Date(endDate).getTime() / 1000) + 86400;
            }
            break;

          default:
            break;
        }

        setLoadingProgress(30);

        setLoadingText("Connecting to Firebase...");

        const logsQuery = query(
          ref(db, "energy_logs/device_001"),
          orderByChild("timestamp"),
          startAt(startTimestamp),
          endAt(endTimestamp)
        );

        unsubscribe = onValue(logsQuery, (snapshot) => {
          setLoadingProgress(60);

          setLoadingText("Downloading telemetry...");

          const data = snapshot.val();

          if (!data) {
            setLogs([]);

            setLatest(null);

            setLoading(false);

            setInitialLoading(false);

            return;
          }

          const parsedLogs = Object.entries(data)
            .map(([key, value]) => ({
              id: key,
              ...value,
            }))
            .sort((a, b) => b.timestamp - a.timestamp);

          // =====================================
          // CACHE 1D DATA
          // =====================================

          if (["1H", "6H", "1D"].includes(selectedFilter)) {
            setCached1DLogs(parsedLogs);
          }

          setLogs(parsedLogs);

          setLatest(parsedLogs[0]);

          // =====================================
          // ONLINE STATUS
          // =====================================

          const latestTimestamp = parsedLogs[0]?.timestamp || 0;

          const diff = Math.floor(Date.now() / 1000) - latestTimestamp;

          setIsOnline(diff <= 80);

          setLoadingProgress(100);

          setLoadingText("Realtime sync active");

          setTimeout(() => {
            setLoading(false);

            setInitialLoading(false);
          }, 300);
        });
      } catch (err) {
        console.error(err);

        setLoading(false);

        setInitialLoading(false);
      }
    }

    fetchLogs();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [selectedFilter, startDate, endDate]);
  // =========================================
  // FILTER LOGS
  // =========================================
  let filteredLogs = [...logs];

  const now = Math.floor(Date.now() / 1000);

  if (selectedFilter === "1H") {
    filteredLogs = logs.filter((log) => log.timestamp >= now - 3600);
  }

  if (selectedFilter === "6H") {
    filteredLogs = logs.filter((log) => log.timestamp >= now - 6 * 3600);
  }
  // =========================================

  // PAGINATION

  // =========================================

  const totalPages = Math.ceil(filteredLogs.length / LOGS_PER_PAGE);

  const startIndex = (currentPage - 1) * LOGS_PER_PAGE;

  const endIndex = startIndex + LOGS_PER_PAGE;

  const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

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
  const exportPDF = () => {
    const doc = new jsPDF();

    doc.setFontSize(18);

    doc.text("Zen Energy Telemetry Logs", 14, 20);

    doc.setFontSize(11);

    doc.text(`Filter: ${selectedFilter}`, 14, 30);

    autoTable(doc, {
      startY: 40,

      head: [
        ["Timestamp", "Power (W)", "Voltage (V)", "Current (A)", "Energy (Wh)"],
      ],

      body: preparedExportData.map((row) => [
        row.Timestamp,
        row["Power (W)"].toFixed(2),
        row["Voltage (V)"].toFixed(2),
        row["Current (A)"].toFixed(2),
        row["Energy (Wh)"].toFixed(3),
      ]),

      styles: {
        fontSize: 8,
        cellPadding: 3,
      },

      headStyles: {
        fillColor: [20, 20, 20],
      },
    });
    setShowExportOptions(false);

    doc.save(`Zen_Telemetry_${selectedFilter}.pdf`);
  };
  const prepareExport = async () => {
    setExporting(true);

    setExportReady(false);

    setShowExportOptions(false);

    setExportProgress(0);

    // STEP 1
    setExportProgress(20);

    await new Promise((r) => setTimeout(r, 300));

    // STEP 2
    const exportLogs = filteredLogs.map((log) => ({
      Timestamp: new Date(log.timestamp * 1000).toLocaleString(),

      "Power (W)": log.avg_power,

      "Voltage (V)": log.avg_voltage,

      "Current (A)": log.avg_current,

      "Energy (Wh)": log.energy_wh,
    }));

    setPreparedExportData(exportLogs);

    setExportProgress(55);

    await new Promise((r) => setTimeout(r, 300));

    // STEP 3
    setExportProgress(80);

    await new Promise((r) => setTimeout(r, 300));

    // STEP 4
    setExportProgress(100);

    setExportReady(true);

    setExporting(false);
  };
  const exportExcel = async () => {
    try {
      setExporting(true);

      setExportReady(false);

      setExportProgress(10);

      await new Promise((r) => setTimeout(r, 250));

      // =====================================
      // TITLE
      // =====================================

      const rows = [
        [
          {
            value: "Zen Energy Telemetry Dashboard",

            fontWeight: "bold",

            fontSize: 20,

            height: 35,

            align: "center",

            columnSpan: 5,
          },
        ],

        [],

        [
          {
            value: `Export Filter: ${selectedFilter}`,

            fontWeight: "bold",

            color: "#666666",

            columnSpan: 5,
          },
        ],

        [],
      ];

      setExportProgress(30);

      await new Promise((r) => setTimeout(r, 250));

      // =====================================
      // HEADERS
      // =====================================

      rows.push([
        {
          value: "Timestamp",

          fontWeight: "bold",

          backgroundColor: "#111827",

          color: "#ffffff",

          align: "center",
        },

        {
          value: "Power (W)",

          fontWeight: "bold",

          backgroundColor: "#111827",

          color: "#ffffff",

          align: "center",
        },

        {
          value: "Voltage (V)",

          fontWeight: "bold",

          backgroundColor: "#111827",

          color: "#ffffff",

          align: "center",
        },

        {
          value: "Current (A)",

          fontWeight: "bold",

          backgroundColor: "#111827",

          color: "#ffffff",

          align: "center",
        },

        {
          value: "Energy (Wh)",

          fontWeight: "bold",

          backgroundColor: "#111827",

          color: "#ffffff",

          align: "center",
        },
      ]);

      setExportProgress(50);

      await new Promise((r) => setTimeout(r, 250));

      // =====================================
      // DATA
      // =====================================

      filteredLogs.forEach((log) => {
        rows.push([
          {
            value: new Date(log.timestamp * 1000).toLocaleString(),

            align: "center",
          },

          {
            value: Number(log.avg_power.toFixed(2)),

            type: Number,

            align: "center",
          },

          {
            value: Number(log.avg_voltage.toFixed(2)),

            type: Number,

            align: "center",
          },

          {
            value: Number(log.avg_current.toFixed(2)),

            type: Number,

            align: "center",
          },

          {
            value: Number(log.energy_wh.toFixed(3)),

            type: Number,

            align: "center",
          },
        ]);
      });

      setExportProgress(75);

      await new Promise((r) => setTimeout(r, 250));

      // =====================================
      // WRITE FILE
      // =====================================

      await writeXlsxFile(rows, {
        fileName: `Zen_Telemetry_${selectedFilter}.xlsx`,

        sheet: "Telemetry Logs",

        columns: [
          { width: 32 },
          { width: 18 },
          { width: 18 },
          { width: 18 },
          { width: 18 },
        ],
      });

      setExportProgress(100);

      setExportReady(true);

      setExporting(false);
    } catch (err) {
      console.error(err);

      setExporting(false);
    }
    setShowExportOptions(false);
  };
  const exportCSV = () => {
    const headers = [
      "Timestamp",
      "Power (W)",
      "Voltage (V)",
      "Current (A)",
      "Energy (Wh)",
    ];

    const rows = preparedExportData.map((row) => [
      `"${row.Timestamp}"`,
      row["Power (W)"],
      row["Voltage (V)"],
      row["Current (A)"],
      row["Energy (Wh)"],
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((r) => r.join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;

    link.setAttribute("download", `Zen_Telemetry_${selectedFilter}.csv`);

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);

    setShowExportOptions(false);
  };
  const exportMenuRef = useRef(null);
  if (initialLoading) {
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
        <section className="relative bg-white border border-neutral-200 rounded-3xl p-3 sm:p-6 shadow-sm mb-8">
          {loading && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-sm flex items-center justify-center rounded-3xl z-50">
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 border-4 border-neutral-300 border-t-black rounded-full animate-spin" />

                <p className="mt-4 text-sm text-neutral-600">
                  Fetching telemetry...
                </p>
              </div>
            </div>
          )}
          <div className="mb-6">
            <h2 className="text-xl font-semibold">Energy Analytics</h2>

            <p className="text-neutral-500 text-sm mt-1">
              Realtime telemetry and historical trends
            </p>
          </div>

          {/* FILTERS */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
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

            {/* EXPORT BUTTON */}
            <button
              onClick={prepareExport}
              disabled={exporting}
              className="px-4 py-2 rounded-xl text-sm border border-neutral-200 bg-white hover:bg-neutral-100 transition"
            >
              {exporting ? "Preparing..." : "Export"}
            </button>

            {/* MINI PROGRESS */}
            {(exporting || exportReady) && (
              <div className="flex items-center gap-3">
                <div className="w-40 h-2 bg-neutral-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-black transition-all duration-300"
                    style={{
                      width: `${exportProgress}%`,
                    }}
                  />
                </div>

                <p className="text-sm text-neutral-500">{exportProgress}%</p>
              </div>
            )}

            {/* DOWNLOAD OPTIONS */}
            {exportReady && (
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportOptions(!showExportOptions)}
                  className="px-4 py-2 rounded-xl text-sm bg-black text-white"
                >
                  Download
                </button>

                {showExportOptions && (
                  <div className="absolute top-14 left-0 bg-white border border-neutral-200 rounded-2xl shadow-lg p-2 z-50 w-40">
                    <button
                      onClick={exportExcel}
                      className="w-full text-left px-4 py-2 rounded-xl hover:bg-neutral-100 text-sm"
                    >
                      Export Excel
                    </button>

                    <button
                      onClick={exportPDF}
                      className="w-full text-left px-4 py-2 rounded-xl hover:bg-neutral-100 text-sm"
                    >
                      Export PDF
                    </button>

                    <button
                      onClick={exportCSV}
                      className="w-full text-left px-4 py-2 rounded-xl hover:bg-neutral-100 text-sm"
                    >
                      Export CSV
                    </button>
                  </div>
                )}
              </div>
            )}
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

      <p className="text-sm text-neutral-400 mt-2">{subtitle}</p>
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
