<template>
  <v-chart v-if="chartOption" :option="chartOption" class="h-56" autoresize />
  <div v-else class="h-56 flex items-center justify-center text-gray-600 text-sm">
    {{ store.collectingDevices.length ? '正在等待采集数据…' : '暂无采集中的设备，开启设备后显示趋势' }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'
import { useModbusStore } from '../store/modbus'
import type { EChartsOption } from 'echarts'

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent])

const store = useModbusStore()

const chartOption = computed<EChartsOption | null>(() => {
  // 只画还在采集（在线、开关打开、无故障）的设备；设备被停止或摘出后曲线随之消失
  const actives = store.activeDevices
  if (!actives.length) return null

  const colors = ['#f97316', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#60a5fa', '#4ade80']
  const series: any[] = []
  let colorIndex = 0

  for (const dev of actives) {
    for (const reg of dev.registers) {
      const key = `${dev.id}_${reg.address}`
      const hd = store.historyData[key]
      if (!hd || !hd.values.length) continue
      series.push({
        name: `${dev.name}-${reg.name}`,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { color: colors[colorIndex % colors.length], width: 2 },
        itemStyle: { color: colors[colorIndex % colors.length] },
        data: hd.time.map((t, j) => [t, hd.values[j]])
      })
      colorIndex++
    }
  }

  if (!series.length) return null
  return {
    tooltip: { trigger: 'axis' },
    legend: { textStyle: { color: '#999' }, top: 0, type: 'scroll' },
    grid: { left: 50, right: 20, top: 30, bottom: 25 },
    xAxis: { type: 'value', axisLabel: { color: '#666', formatter: (v: number) => new Date(v).toLocaleTimeString() }, splitLine: { lineStyle: { color: '#1f2937' } } },
    yAxis: { type: 'value', axisLabel: { color: '#666' }, splitLine: { lineStyle: { color: '#1f2937' } } },
    series
  }
})
</script>
