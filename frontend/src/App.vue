<template>
  <div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-72 bg-gray-900 p-4 flex flex-col gap-3 border-r border-gray-800 overflow-y-auto">
      <h1 class="text-lg font-bold text-orange-400">Modbus 工业监控</h1>

      <!-- 全局一键启停（保持原有能力） -->
      <div class="flex gap-2">
        <button @click="store.startAll()" :disabled="!canStartAll" class="flex-1 bg-green-700 py-1.5 rounded text-xs hover:bg-green-600 disabled:opacity-50">
          {{ store.isPolling ? '采集中...' : '一键开始' }}
        </button>
        <button @click="store.stopAll()" :disabled="!store.collectingDevices.length" class="flex-1 bg-red-700 py-1.5 rounded text-xs hover:bg-red-600 disabled:opacity-50">
          一键停止
        </button>
      </div>

      <div>
        <label class="text-gray-400 text-xs">轮询间隔: {{ store.pollInterval }}ms（调整不影响各设备开关）</label>
        <input type="range" v-model.number="store.pollInterval" min="200" max="5000" step="100" class="w-full" />
      </div>

      <!-- 批量启停 -->
      <div class="flex items-center gap-2">
        <h3 class="text-gray-400 text-xs flex-1">设备清单（多选后整组控制）</h3>
        <span class="text-[10px] text-gray-500">已选 {{ store.checkedDeviceIds.length }}</span>
      </div>
      <div class="flex gap-2">
        <button @click="store.startChecked()" :disabled="!store.checkedDeviceIds.length"
          class="flex-1 bg-emerald-800 py-1 rounded text-xs hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
          批量开始
        </button>
        <button @click="store.stopChecked()" :disabled="!store.checkedDeviceIds.length"
          class="flex-1 bg-rose-800 py-1 rounded text-xs hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed">
          批量停止
        </button>
      </div>

      <!-- 设备列表：每台可单独控制 -->
      <div v-for="d in store.devices" :key="d.id"
        class="rounded p-2 text-sm transition-colors"
        :class="[
          store.selectedDevice?.id === d.id ? 'bg-gray-800 ring-1 ring-orange-500' : 'bg-gray-800 hover:bg-gray-700/60',
          d.error ? 'border border-red-500/70' : ''
        ]">
        <div class="flex items-center gap-2">
          <input type="checkbox" class="accent-orange-500 cursor-pointer"
            :checked="store.checkedDeviceIds.includes(d.id)"
            @click.stop="store.toggleChecked(d.id)" />
          <div class="flex-1 cursor-pointer min-w-0" @click="store.selectDevice(d.id)">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate">{{ d.name }}</span>
              <!-- 在线/采集状态点：与卡片区完全一致 -->
              <span class="w-2 h-2 rounded-full shrink-0" :class="statusDotClass(d)" :title="statusTitle(d)"></span>
            </div>
            <div class="text-[11px] text-gray-500 truncate">{{ d.ip }}:{{ d.port }} [{{ d.slaveId }}]</div>
          </div>
        </div>

        <!-- 状态行 -->
        <div class="mt-1 ml-6 text-[11px]">
          <span v-if="d.error" class="text-red-400">⚠ {{ d.error }}</span>
          <span v-else-if="d.collecting" class="text-green-400">● 采集中</span>
          <span v-else-if="!d.online" class="text-gray-500">离线</span>
          <span v-else class="text-gray-500">未采集</span>
        </div>

        <!-- 逐台操作 -->
        <div class="flex gap-1.5 mt-1.5 ml-6">
          <button v-if="d.error" @click.stop="store.retryDevice(d.id)"
            class="px-2 py-0.5 rounded text-[11px] bg-amber-700 hover:bg-amber-600">
            重试
          </button>
          <button v-if="!d.collecting && !d.error" @click.stop="store.startDevice(d.id)"
            class="px-2 py-0.5 rounded text-[11px] bg-green-800 hover:bg-green-700 disabled:opacity-40"
            :disabled="!d.online">
            开始
          </button>
          <button v-if="d.collecting" @click.stop="store.stopDevice(d.id)"
            class="px-2 py-0.5 rounded text-[11px] bg-red-800 hover:bg-red-700">
            停止
          </button>
        </div>
      </div>

      <div v-if="store.criticalAlarms.length" class="bg-red-900/50 rounded p-2 mt-1">
        <h4 class="text-red-400 text-xs font-bold">⚠ 严重告警 {{ store.criticalAlarms.length }}</h4>
        <div v-for="a in store.criticalAlarms.slice(0, 3)" :key="a.id" class="text-xs text-red-300 mt-1 truncate">
          {{ a.message }}
        </div>
      </div>

      <div class="text-xs text-gray-600 mt-auto pt-2 border-t border-gray-800">
        在线: {{ store.onlineDevices.length }}/{{ store.devices.length }} ·
        采集中: {{ store.collectingDevices.length }}
      </div>
    </div>

    <!-- Main Dashboard -->
    <div class="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
      <!-- 逐台操作结果 -->
      <div v-if="store.opResults.length" class="bg-gray-900 rounded-xl p-3">
        <div class="flex items-center justify-between mb-2">
          <h3 class="text-sm text-gray-400">操作结果（逐台）</h3>
          <button @click="store.clearResults()" class="text-[11px] text-gray-500 hover:text-gray-300">清空</button>
        </div>
        <div class="flex flex-col gap-1 max-h-28 overflow-y-auto">
          <div v-for="r in store.opResults.slice(0, 8)" :key="r.id"
            class="flex items-center gap-2 text-xs bg-gray-800 rounded px-2 py-1">
            <span :class="r.success ? 'text-green-400' : 'text-red-400'" class="shrink-0">
              {{ r.success ? '✓' : '✕' }}
            </span>
            <span class="text-gray-300 shrink-0">[{{ actionLabel(r.action) }}]</span>
            <span class="flex-1 truncate" :class="r.success ? 'text-gray-300' : 'text-red-300'">{{ r.message }}</span>
            <span class="text-gray-500 shrink-0">{{ new Date(r.timestamp).toLocaleTimeString() }}</span>
          </div>
        </div>
      </div>

      <!-- 设备卡片：按选中/采集状态排列；只画还在采集的实时数据 -->
      <div class="flex flex-col gap-3">
        <div v-for="d in orderedDevices" :key="d.id"
          class="rounded-xl p-3 border transition-colors"
          :class="cardClass(d)">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2 cursor-pointer" @click="store.selectDevice(d.id)">
              <span class="w-2 h-2 rounded-full" :class="statusDotClass(d)" :title="statusTitle(d)"></span>
              <span class="text-sm" :class="d.collecting ? 'text-gray-100' : 'text-gray-500'">{{ d.name }}</span>
              <span class="text-[10px] text-gray-500">{{ d.ip }}</span>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="d.error" class="text-[11px] text-red-400 truncate max-w-[220px]">⚠ {{ d.error }}</span>
              <button v-if="d.error" @click="store.retryDevice(d.id)"
                class="text-[11px] px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600">重试</button>
              <button v-else-if="d.collecting" @click="store.stopDevice(d.id)"
                class="text-[11px] px-2 py-0.5 rounded bg-red-800 hover:bg-red-700">停止</button>
              <button v-else @click="store.startDevice(d.id)" :disabled="!d.online"
                class="text-[11px] px-2 py-0.5 rounded bg-green-800 hover:bg-green-700 disabled:opacity-40">开始</button>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            <div v-for="r in d.registers" :key="r.address"
              class="bg-gray-950/60 rounded-lg px-3 py-2"
              :class="d.collecting ? '' : 'opacity-50'">
              <div class="text-[11px] text-gray-400">{{ r.name }} {{ r.unit }}</div>
              <div class="text-xl font-bold"
                :class="d.collecting ? (d.online ? 'text-orange-400' : 'text-gray-600') : 'text-gray-600'">
                {{ typeof r.value === 'number'
                  ? r.value.toFixed(r.value > 100 ? 0 : 1)
                  : r.value ? 'ON' : 'OFF' }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chart：只绘制还在采集的设备 -->
      <div class="bg-gray-900 rounded-xl p-3 flex-1">
        <h3 class="text-sm text-gray-400 mb-2">
          实时趋势 — 采集中设备 {{ store.collectingDevices.length }} 台
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useModbusStore } from './store/modbus'
import TrendChart from './components/TrendChart.vue'
import type { Device, CollectAction } from './types'

const store = useModbusStore()

const canStartAll = computed(() =>
  store.devices.some(d => d.online && (!d.collecting || !!d.error))
)

// 卡片区排列：选中设备置顶，其次采集中的设备，最后未采集；切换选中/开关后布局跟着更新
const orderedDevices = computed(() => {
  const rank = (d: Device) => {
    if (store.selectedDevice?.id === d.id) return 0
    if (d.collecting) return 1
    return 2
  }
  return [...store.devices].sort((a, b) => rank(a) - rank(b) || a.slaveId - b.slaveId)
})

function statusDotClass(d: Device) {
  if (d.error) return 'bg-red-500 animate-pulse'
  if (d.collecting) return 'bg-green-500'
  if (d.online) return 'bg-yellow-500'
  return 'bg-gray-600'
}

function statusTitle(d: Device) {
  if (d.error) return d.error
  if (d.collecting) return '采集中'
  if (d.online) return '在线（未采集）'
  return '离线'
}

function cardClass(d: Device) {
  if (d.error) return 'bg-gray-900 border-red-500/70'
  if (d.collecting) return 'bg-gray-900 border-green-700/60'
  return 'bg-gray-900/60 border-gray-800'
}

function actionLabel(a: CollectAction) {
  return { start: '开始', stop: '停止', retry: '重试', fault: '故障' }[a]
}

onMounted(() => store.initMockDevices())
onUnmounted(() => store.stopScheduler())
</script>
