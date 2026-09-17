<template>
  <v-chart v-if="chartOption" :option="chartOption" :update-options="{ replaceMerge: ['series'] }" class="h-56" autoresize />
  <div v-else class="h-56 flex items-center justify-center text-gray-600 text-sm">
    {{ store.devices.length ? '暂无采集中的设备，开始采集后显示趋势' : '开始采集后显示趋势' }}
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

// 颜色按设备在清单中的序号稳定分配，切换选中/启停后不会串色
const DEVICE_COLORS = ['#f97316', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#facc15']

const chartOption = computed<EChartsOption | null>(() => {
  // 只画还在采集、且未因掉线/读数失败挂起的设备
  const active = store.devices.filter(d => d.collecting && !d.error)
  const series: any[] = []
  active.forEach(dev => {
    const devColor = DEVICE_COLORS[store.devices.indexOf(dev) % DEVICE_COLORS.length]
    dev.registers.forEach(reg => {
      const key = `${dev.id}_${reg.address}`
      const hd = store.historyData[key]
      if (!hd || !hd.values.length) return
      const multi = active.length > 1
      series.push({
        name: multi ? `${dev.name}·${reg.name}` : reg.name,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { color: devColor, width: 2 },
        data: hd.time.map((t, j) => [t, hd.values[j]])
      })
    })
  })
  if (!series.length) return null
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', textStyle: { color: '#999' }, top: 0 },
    grid: { left: 50, right: 20, top: 30, bottom: 25 },
    xAxis: { type: 'value', axisLabel: { color: '#666', formatter: (v: number) => new Date(v).toLocaleTimeString() }, splitLine: { lineStyle: { color: '#1f2937' } } },
    yAxis: { type: 'value', axisLabel: { color: '#666' }, splitLine: { lineStyle: { color: '#1f2937' } } },
    series
  }
})
</script>
