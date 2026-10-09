import React from 'react'

export function HeatmapBar({ data }: { data: number[] }) {
  return (
    <div className="w-full h-2 flex">
      {data.map((value, i) => {
        let color = 'bg-green-500'

        if (value > 0.25) color = 'bg-yellow-400'
        if (value > 0.5) color = 'bg-orange-500'
        if (value > 0.75) color = 'bg-red-600'

        return (
          <div
            key={i}
            className={`${color} flex-1 transition-colors duration-150`}
          />
        )
      })}
    </div>
  )
}
