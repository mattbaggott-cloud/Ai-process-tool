"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const DEFAULT_COLORS = ["#2563eb", "#16a34a", "#f59e0b", "#8b5cf6", "#ec4899"];

interface ChartRendererProps {
  chartType: "bar" | "line" | "pie" | "area";
  chartData: Record<string, unknown>[];
  chartConfig: {
    title?: string;
    xKey?: string;
    yKeys?: string[];
    colors?: string[];
  };
}

export default function ChartRenderer({ chartType, chartData, chartConfig }: ChartRendererProps) {
  const { xKey = "name", yKeys = [], colors = DEFAULT_COLORS } = chartConfig;
  const palette = colors.length > 0 ? colors : DEFAULT_COLORS;

  /* Auto-detect yKeys if not provided */
  const effectiveYKeys = yKeys.length > 0
    ? yKeys
    : chartData.length > 0
      ? Object.keys(chartData[0]).filter((k) => k !== xKey && typeof chartData[0][k] === "number")
      : [];

  if (chartType === "pie") {
    const valueKey = effectiveYKeys[0] ?? "value";
    return (
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey={valueKey}
            nameKey={xKey}
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name }: { name?: string | number }) => String(name ?? "")}
          >
            {chartData.map((_, idx) => (
              <Cell key={idx} fill={palette[idx % palette.length]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          {effectiveYKeys.map((key, idx) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={palette[idx % palette.length]}
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "area") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey={xKey} />
          <YAxis />
          <Tooltip />
          <Legend />
          {effectiveYKeys.map((key, idx) => (
            <Area
              key={key}
              type="monotone"
              dataKey={key}
              stroke={palette[idx % palette.length]}
              fill={palette[idx % palette.length]}
              fillOpacity={0.3}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  /* Default: bar chart */
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Legend />
        {effectiveYKeys.map((key, idx) => (
          <Bar key={key} dataKey={key} fill={palette[idx % palette.length]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
