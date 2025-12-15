
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChartDataPoint } from '../types';

interface StatsChartProps {
  data: ChartDataPoint[];
}

export const StatsChart: React.FC<StatsChartProps> = ({ data }) => {
  return (
    <div className="w-full h-[250px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{
            top: 10,
            right: 30,
            left: 0,
            bottom: 0,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
          <XAxis 
            dataKey="round" 
            stroke="#94a3b8" 
            tick={{fontSize: 12}}
            label={{ value: 'Deposits (Time)', position: 'insideBottomRight', offset: -5, fill: '#64748b', fontSize: 10 }} 
          />
          <YAxis 
            stroke="#94a3b8" 
            tick={{fontSize: 12}}
            label={{ value: 'Amount ($)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }}
          />
          <Tooltip 
            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f1f5f9' }}
            itemStyle={{ color: '#e2e8f0' }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Area 
            type="monotone" 
            dataKey="requiredNewLiquidity" 
            name="Debt Liability" 
            stackId="1" 
            stroke="#ef4444" 
            fill="#ef4444" 
            fillOpacity={0.2} 
            isAnimationActive={false}
          />
          <Area 
            type="monotone" 
            dataKey="protocolReserves" 
            name="Protocol Reserves" 
            stackId="2" 
            stroke="#10b981" 
            fill="#10b981" 
            fillOpacity={0.3} 
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
