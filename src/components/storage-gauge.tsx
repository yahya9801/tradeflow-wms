"use client";

import { RadialBar, RadialBarChart, PolarAngleAxis, ResponsiveContainer } from "recharts";

/** Overall storage occupancy as a radial gauge. Colour shifts as it fills. */
export function StorageGauge({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill = clamped >= 100 ? "#d03b3b" : clamped >= 80 ? "#fab219" : "#0f9d8c";
  return (
    <div className="relative h-40 w-40">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ value: clamped, fill }]} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={999} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{Math.round(clamped)}%</span>
        <span className="text-xs text-muted-foreground">occupied</span>
      </div>
    </div>
  );
}
