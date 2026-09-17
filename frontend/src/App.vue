<template>
  <div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-72 bg-gray-900 p-4 flex flex-col gap-3 border-r border-gray-800 overflow-y-auto">
      <h1 class="text-lg font-bold text-orange-400">Modbus 工业监控</h1>

      <!-- 一键开始 / 一键停止：保持原有整体控制 -->
      <div class="flex gap-2">
        <button @click="startAll" :disabled="allCollecting"
          class="flex-1 bg-green-700 py-1.5 rounded text-xs hover:bg-green-600 disabled:opacity-50">
          {{ store.isPolling ? '采集中...' : '一键开始' }}
        </button>
        <button @click="stopAll" :disabled="!store.isPolling"
          class="flex-1 bg-red-700 py-1.5 rounded text-xs hover:bg-red-600 disabled:opacity-50">
          一键停止
        </button>
      </div>

      <div>
        <label class="text-gray-400 text-xs">轮询间隔: {{ store.pollInterval }}ms</label>
        <input type="range" v-model.number="store.pollInterval" min="200" max="5000" step="100" class="w-full" />
      </div>

      <!-- 多选批量启停工具条 -->
      <div v-if="store.checkedIds.length"
        class="flex items-center gap-2 bg-gray-800/80 rounded p-2 text-xs">
        <span class="text-gray-300 shrink-0">已选 {{ store.checkedIds.length }} 台</span>
        <button @click="batchStartChecked" class="flex-1 bg-green-700/90 py-1 rounded hover:bg-green-600">整组开始</button>
        <button @click="batchStopChecked" class="flex-1 bg-red-700/90 py-1 rounded hover:bg-red-600">整组停止</button>
        <button @click="store.checkedIds = []" class="text-gray-500 hover:text-gray-300">清空</button>
      </div>

      <h3 class="text-gray-400 text-xs mt-1">设备列表</h3>

      <!-- 单台设备：多选框 + 在线状态 + 单独采集开关 -->
      <div v-for="d in store.devices" :key="d.id"
        class="bg-gray-800 rounded p-2 text-sm transition"
        :class="[
          store.selectedDevice?.id === d.id ? 'ring-1 ring-orange-500' : '',
          d.error ? 'border border-red-500/70' : ''
        ]">
        <div class="flex items-center gap-2">
          <input type="checkbox" class="accent-orange-500"
            :checked="store.checkedIds.includes(d.id)"
            @click.stop
            @change="store.toggleChecked(d.id)" />
          <div class="flex-1 min-w-0 cursor-pointer" @click="store.selectDevice(d)">
            <div class="flex justify-between items-center">
              <span class="truncate">{{ d.name }}</span>
              <!-- 在线状态点：与卡片区同一数据源 -->
              <span class="w-2 h-2 rounded-full shrink-0"
                :class="d.online ? 'bg-green-500' : 'bg-red-500'"
                :title="d.online ? '在线' : '离线'"></span>
            </div>
            <div class="text-xs text-gray-500 truncate">{{ d.ip }}:{{ d.port }} [{{ d.slaveId }}]</div>
          </div>
          <!-- 单台采集开关 -->
          <button @click.stop="toggleOne(d)"
            class="shrink-0 px-2 py-1 rounded text-[11px] text-white"
            :class="d.collecting ? 'bg-red-700 hover:bg-red-600' : 'bg-green-700 hover:bg-green-600'">
            {{ d.collecting ? '停止' : '开始' }}
          </button>
        </div>

        <!-- 采集状态 / 异常标出与重试入口 -->
        <div v-if="d.collecting" class="mt-1.5 pl-6 text-[11px] flex items-center gap-2">
          <template v-if="d.error">
            <span class="text-red-400 font-bold">
              ✕ {{ d.error === 'offline' ? '设备掉线，已暂停该台采集' : '读数失败（通讯超时），已暂停该台采集' }}
            </span>
            <button @click.stop="store.retryOne(d.id)" class="px-1.5 py-0.5 bg-orange-600 hover:bg-orange-500 rounded text-white">重试</button>
            <button v-if="!d.online" @click.stop="store.toggleDevice(d.id)" class="text-gray-500 hover:text-gray-300 underline">模拟上线</button>
          </template>
          <template v-else>
            <span class="flex items-center gap-1 text-green-400">
              <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>采集中
            </span>
            <span v-if="d.lastPollAt" class="text-gray-500">{{ formatTime(d.lastPollAt) }}</span>
          </template>
        </div>
        <div v-else-if="d.error" class="mt-1.5 pl-6 text-[11px] text-gray-500">未采集</div>
      </div>

      <div v-if="store.criticalAlarms.length" class="bg-red-900/50 rounded p-2 mt-2">
        <h4 class="text-red-400 text-xs font-bold">⚠ 严重告警 {{ store.criticalAlarms.length }}</h4>
        <div v-for="a in store.criticalAlarms.slice(0, 3)" :key="a.id" class="text-xs text-red-300 mt-1 truncate">
          {{ a.message }}
        </div>
      </div>

      <div class="text-xs text-gray-600 mt-auto pt-2">
        在线: {{ store.onlineDevices.length }}/{{ store.devices.length }} ·
        采集中: {{ store.collectingDevices.length }}
      </div>
    </div>

    <!-- Main Dashboard -->
    <div class="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
      <!-- Register Gauges：只展示采集中的设备，布局随数量更新 -->
      <div v-if="cardEntries.length" class="grid gap-3" :class="gridClass">
        <div v-for="entry in cardEntries" :key="`${entry.dev.id}_${entry.reg.address}`"
          class="bg-gray-900 rounded-xl p-3 transition"
          :class="[
            entry.dev.error ? 'border border-red-500/70 opacity-70' : '',
            store.selectedDevice?.id === entry.dev.id ? 'ring-1 ring-orange-500/70' : ''
          ]">
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-400 truncate">{{ entry.dev.name }}</span>
            <span class="w-2 h-2 rounded-full shrink-0 ml-2"
              :class="entry.dev.online ? 'bg-green-500' : 'bg-red-500'"></span>
          </div>
          <div class="text-2xl font-bold" :class="entry.dev.error ? 'text-gray-600' : 'text-orange-400'">
            {{ formatValue(entry.reg.value) }}
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-gray-500 truncate">{{ entry.reg.name }} {{ entry.reg.unit }}</span>
            <button v-if="entry.dev.error"
              @click="store.retryOne(entry.dev.id)"
              class="shrink-0 px-1.5 py-0.5 bg-orange-600 hover:bg-orange-500 rounded text-[11px] text-white">重试</button>
          </div>
          <div v-if="entry.dev.error" class="text-[11px] text-red-400 mt-1 truncate">
            {{ entry.dev.error === 'offline' ? '设备掉线，等待重试' : '读数失败，等待重试' }}
          </div>
        </div>
      </div>
      <div v-else class="bg-gray-900 rounded-xl p-6 text-center text-sm text-gray-500">
        暂无采集中的设备，请在侧栏对单台设备点“开始”，或勾选多台后“整组开始”
      </div>

      <!-- Chart：只画还在采集的设备 -->
      <div class="bg-gray-900 rounded-xl p-3 flex-1">
        <h3 class="text-sm text-gray-400 mb-2">
          实时趋势 — 采集中 {{ store.collectingDevices.length }} 台
          <span v-if="store.selectedDevice" class="text-gray-600">（当前选中：{{ store.selectedDevice.name }}）</span>
        </h3>
        <TrendChart />
      </div>

      <!-- Alarm List -->
      <div class="bg-gray-900 rounded-xl p-3 max-h-48 overflow-y-auto">
        <h3 class="text-sm text-gray-400 mb-2">告警记录</h3>
        <div v-for="a in store.alarms.slice(0, 10)" :key="a.id"
          class="flex justify-between text-xs bg-gray-800 rounded p-2 mb-1"
          :class="{ 'border-l-4 border-red-500': a.level === 'critical', 'border-l-4 border-yellow-500': a.level === 'warning' }">
          <span>{{ a.message }}</span>
          <div class="flex gap-2">
            <span class="text-gray-500">{{ new Date(a.timestamp).toLocaleTimeString() }}</span>
            <button v-if="!a.acknowledged" @click="store.acknowledgeAlarm(a.id)" class="text-blue-400 hover:underline">确认</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 逐台操作结果 -->
    <OperationResults />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { useModbusStore } from './store/modbus'
import type { Device, ModbusRegister } from './types'
import TrendChart from './components/TrendChart.vue'
import OperationResults from './components/OperationResults.vue'

const store = useModbusStore()
let timer: number | null = null

// ---------- 整体启停（原有）与单台/多选启停 ----------
function startAll() {
  store.batchStart(store.devices.map(d => d.id))
}
function stopAll() {
  store.batchStop(store.collectingDevices.map(d => d.id))
}
function toggleOne(d: Device) {
  if (d.collecting) store.batchStop([d.id])
  else store.batchStart([d.id])
}
function batchStartChecked() {
  store.batchStart([...store.checkedIds])
}
function batchStopChecked() {
  store.batchStop([...store.checkedIds])
}

const allCollecting = computed(() =>
  store.devices.length > 0 && store.collectingDevices.length === store.devices.length
)

// ---------- 卡片区：只列采集中的设备（含等待重试的失败设备，单独标出）----------
const cardEntries = computed(() => {
  const entries: { dev: Device; reg: ModbusRegister }[] = []
  for (const dev of store.devices) {
    if (!dev.collecting) continue
    for (const reg of dev.registers) entries.push({ dev, reg })
  }
  return entries
})

// 卡片排列布局随采集设备数量更新
const gridClass = computed(() => {
  const n = cardEntries.value.length
  if (n <= 2) return 'grid-cols-2'
  if (n <= 3) return 'grid-cols-3'
  if (n <= 4) return 'grid-cols-4'
  if (n <= 6) return 'grid-cols-3'
  if (n <= 8) return 'grid-cols-4'
  return 'grid-cols-5'
})

function formatValue(v: number | boolean) {
  if (typeof v === 'number') return v.toFixed(v > 100 ? 0 : 1)
  return v ? 'ON' : 'OFF'
}
function formatTime(t: number) {
  return new Date(t).toLocaleTimeString()
}

// ---------- 轮询定时器：由各设备采集开关派生；调整间隔只重建定时器，开关状态不动 ----------
function syncTimer() {
  if (timer !== null) { clearInterval(timer); timer = null }
  if (store.isPolling) {
    timer = window.setInterval(() => store.simulatePoll(), store.pollInterval)
  }
}
watch(() => [store.isPolling, store.pollInterval], syncTimer)

onMounted(() => {
  store.initMockDevices()
  syncTimer()
})
onUnmounted(() => {
  if (timer !== null) { clearInterval(timer); timer = null }
})
</script>
