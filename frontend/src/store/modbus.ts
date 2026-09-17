import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Device, Alarm, CollectOpResult, CollectAction } from '../types'

const STORAGE_KEY = 'modbus.collect.state.v1'
// 单次轮询中在线设备随机读数失败的概率（模拟偶发读数失败）
const READ_FAIL_RATE = 0.08
// 最近操作结果保留条数
const MAX_RESULTS = 40

interface PersistedState {
  collectingIds: string[]
  selectedId: string | null
  pollInterval: number
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export const useModbusStore = defineStore('modbus', () => {
  const devices = ref<Device[]>([])
  const alarms = ref<Alarm[]>([])
  const historyData = ref<Record<string, { time: number[]; values: number[] }>>({})
  const isPolling = ref(false)
  const pollInterval = ref(1000)
  const selectedDevice = ref<Device | null>(null)
  /** 清单多选（批量启停）勾选的设备 id */
  const checkedDeviceIds = ref<string[]>([])
  /** 逐台操作 / 批量操作 / 运行中故障的结果，按时间倒序 */
  const opResults = ref<CollectOpResult[]>([])

  let timer: number | null = null

  const onlineDevices = computed(() => devices.value.filter(d => d.online))
  const collectingDevices = computed(() => devices.value.filter(d => d.collecting))
  /** 真正参与本轮轮询的设备：在线 + 已开启采集开关 + 无阻断性错误 */
  const activeDevices = computed(() =>
    devices.value.filter(d => d.collecting && d.online && !d.error)
  )
  const criticalAlarms = computed(() => alarms.value.filter(a => a.level === 'critical' && !a.acknowledged))
  const checkedDevices = computed(() =>
    checkedDeviceIds.value
      .map(id => devices.value.find(d => d.id === id))
      .filter((d): d is Device => !!d)
  )

  function persist() {
    const state: PersistedState = {
      collectingIds: devices.value.filter(d => d.collecting).map(d => d.id),
      selectedId: selectedDevice.value?.id ?? null,
      pollInterval: pollInterval.value
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* 忽略持久化失败（隐私模式等） */
    }
  }

  function findDevice(id: string) {
    return devices.value.find(d => d.id === id)
  }

  function pushResult(deviceId: string, deviceName: string, action: CollectAction, success: boolean, message: string) {
    opResults.value.unshift({
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      deviceId, deviceName, action, success, message,
      timestamp: Date.now()
    })
    if (opResults.value.length > MAX_RESULTS) opResults.value.length = MAX_RESULTS
  }

  /** 某台设备掉线或读数失败：单独摘出并标注，不影响其它设备继续采集 */
  function markFault(device: Device, message: string, recordResult = true) {
    device.collecting = false
    device.error = message
    if (recordResult) pushResult(device.id, device.name, 'fault', false, message)
  }

  function clearResults() {
    opResults.value = []
  }

  function dismissResult(id: string) {
    opResults.value = opResults.value.filter(r => r.id !== id)
  }

  function simulateDeviceRead(dev: Device, now: number) {
    if (!dev.online) {
      markFault(dev, `${dev.name} 已掉线，采集中断`)
      return
    }
    // 在线设备仍可能偶发读数失败
    if (Math.random() < READ_FAIL_RATE) {
      markFault(dev, `${dev.name} 读数失败：Modbus 请求超时`)
      return
    }
    for (const reg of dev.registers) {
      if (typeof reg.value === 'number') {
        const noise = (Math.random() - 0.5) * reg.value * 0.02
        reg.value = Math.round((reg.value + noise) * 100) / 100
        reg.updatedAt = now
        const key = `${dev.id}_${reg.address}`
        if (!historyData.value[key]) historyData.value[key] = { time: [], values: [] }
        historyData.value[key].time.push(now)
        historyData.value[key].values.push(reg.value)
        if (historyData.value[key].time.length > 100) {
          historyData.value[key].time.shift()
          historyData.value[key].values.shift()
        }
        // Check thresholds
        if (reg.name === '温度' && reg.value > 28) {
          alarms.value.unshift({
            id: `a_${Date.now()}`, deviceId: dev.id, register: reg.name,
            message: `${dev.name} ${reg.name}超限: ${reg.value}${reg.unit}`,
            level: reg.value > 30 ? 'critical' : 'warning',
            timestamp: now, acknowledged: false
          })
        }
      }
    }
  }

  /** 一轮轮询：各设备互不影响，单台失败只摘出该台 */
  function simulatePoll() {
    const now = Date.now()
    for (const dev of [...devices.value]) {
      if (!dev.collecting || dev.error) continue
      simulateDeviceRead(dev, now)
    }
    if (alarms.value.length > 50) alarms.value = alarms.value.slice(0, 50)
  }

  /* ---------------- 调度（一键启停沿用全局调度，逐台开关不重置调度） ---------------- */

  function stopScheduler() {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    isPolling.value = false
  }

  function startScheduler() {
    stopScheduler()
    isPolling.value = true
    // 立即跑一轮，开始采集后马上能看到读数/结果
    simulatePoll()
    timer = window.setInterval(() => simulatePoll(), pollInterval.value)
  }

  function ensureScheduler() {
    if (activeDevices.value.length && !isPolling.value) startScheduler()
  }

  // 调整轮询间隔：仅重建定时器，各设备采集开关状态保持不变
  watch(pollInterval, () => {
    if (isPolling.value) startScheduler()
    persist()
  })

  /* ---------------- 逐台 / 批量启停 ---------------- */

  /** 开启单台采集；掉线设备开启失败并单独标出，不影响其它设备 */
  function startDevice(id: string, action: CollectAction = 'start'): boolean {
    const dev = findDevice(id)
    if (!dev) return false
    if (dev.collecting && !dev.error) {
      pushResult(dev.id, dev.name, action, true, `${dev.name} 已在采集中`)
      return true
    }
    dev.error = null
    if (!dev.online) {
      markFault(dev, `${dev.name} 已掉线，无法开始采集`, false)
      pushResult(dev.id, dev.name, action, false, `${dev.name} 已掉线，无法开始采集`)
      return false
    }
    dev.collecting = true
    pushResult(dev.id, dev.name, action, true, `${dev.name} 开始采集成功`)
    ensureScheduler()
    return true
  }

  /** 停止单台采集；其它设备继续采集不受影响 */
  function stopDevice(id: string): boolean {
    const dev = findDevice(id)
    if (!dev) return false
    dev.collecting = false
    pushResult(dev.id, dev.name, 'stop', true, `${dev.name} 已停止采集`)
    if (!collectingDevices.value.length) stopScheduler()
    return true
  }

  /** 故障设备重试：清掉错误标记后重新尝试开启 */
  function retryDevice(id: string): boolean {
    return startDevice(id, 'retry')
  }

  /** 批量开启勾选设备（掉线/失败的逐台标出，成功的照常采集） */
  function startChecked() {
    for (const dev of checkedDevices.value) startDevice(dev.id, 'start')
  }

  /** 批量停止勾选设备，逐台给出结果 */
  function stopChecked() {
    for (const dev of checkedDevices.value) stopDevice(dev.id)
  }

  /** 一键开始：开启全部设备（掉线设备逐台标出失败），并启动调度 */
  function startAll() {
    for (const dev of devices.value) {
      if (dev.collecting && !dev.error) continue
      startDevice(dev.id, 'start')
    }
    ensureScheduler()
  }

  /** 一键停止：停掉所有设备并停止调度 */
  function stopAll() {
    for (const dev of devices.value) {
      if (dev.collecting) dev.collecting = false
    }
    stopScheduler()
    pushResult('__all__', '全部设备', 'stop', true, '已一键停止全部设备采集')
  }

  /* ---------------- 多选 / 选中 ---------------- */

  function toggleChecked(id: string) {
    const i = checkedDeviceIds.value.indexOf(id)
    if (i >= 0) checkedDeviceIds.value.splice(i, 1)
    else checkedDeviceIds.value.push(id)
  }

  function selectDevice(id: string) {
    const dev = findDevice(id)
    if (dev) selectedDevice.value = dev
  }

  function acknowledgeAlarm(id: string) {
    const a = alarms.value.find(a => a.id === id)
    if (a) a.acknowledged = true
  }

  function initMockDevices() {
    const persisted = loadPersisted()
    devices.value = [
      {
        id: 'dev1', name: '温湿度传感器-A区', ip: '192.168.1.101', port: 502, slaveId: 1, online: true,
        collecting: false, error: null,
        registers: [
          { address: 0, name: '温度', type: 'holding', value: 25.6, unit: '°C', updatedAt: Date.now() },
          { address: 1, name: '湿度', type: 'holding', value: 62.3, unit: '%RH', updatedAt: Date.now() },
          { address: 2, name: '露点', type: 'holding', value: 17.8, unit: '°C', updatedAt: Date.now() }
        ]
      },
      {
        id: 'dev2', name: '压力变送器-B区', ip: '192.168.1.102', port: 502, slaveId: 2, online: true,
        collecting: false, error: null,
        registers: [
          { address: 0, name: '管道压力', type: 'holding', value: 3.45, unit: 'MPa', updatedAt: Date.now() },
          { address: 1, name: '差压', type: 'holding', value: 0.12, unit: 'kPa', updatedAt: Date.now() }
        ]
      },
      {
        id: 'dev3', name: '电机控制器-C区', ip: '192.168.1.103', port: 502, slaveId: 3, online: false,
        collecting: false, error: null,
        registers: [
          { address: 0, name: '转速', type: 'holding', value: 1480, unit: 'RPM', updatedAt: Date.now() },
          { address: 1, name: '电流', type: 'holding', value: 12.5, unit: 'A', updatedAt: Date.now() },
          { address: 2, name: '运行状态', type: 'coil', value: true, unit: '', updatedAt: Date.now() }
        ]
      },
      {
        id: 'dev4', name: '流量计-D区', ip: '192.168.1.104', port: 502, slaveId: 4, online: true,
        collecting: false, error: null,
        registers: [
          { address: 0, name: '瞬时流量', type: 'holding', value: 156.7, unit: 'L/min', updatedAt: Date.now() },
          { address: 1, name: '累计流量', type: 'holding', value: 98234, unit: 'L', updatedAt: Date.now() }
        ]
      }
    ]

    // 刷新后恢复：哪些设备还在采集、选中项、轮询间隔
    if (typeof persisted.pollInterval === 'number') pollInterval.value = persisted.pollInterval
    const ids = new Set(persisted.collectingIds ?? [])
    for (const dev of devices.value) {
      if (ids.has(dev.id) && dev.online) dev.collecting = true
    }
    const sel = devices.value.find(d => d.id === persisted.selectedId) ?? devices.value[0]
    selectedDevice.value = sel ?? null
    checkedDeviceIds.value = []

    if (collectingDevices.value.length) startScheduler()

    watch([devices, selectedDevice], persist, { deep: true })
  }

  return {
    // state
    devices, alarms, historyData, isPolling, pollInterval,
    selectedDevice, checkedDeviceIds, opResults,
    // getters
    criticalAlarms, onlineDevices, collectingDevices, activeDevices, checkedDevices,
    // actions
    initMockDevices, simulatePoll, acknowledgeAlarm,
    startScheduler, stopScheduler,
    startDevice, stopDevice, retryDevice, startChecked, stopChecked, startAll, stopAll,
    toggleChecked, selectDevice, clearResults, dismissResult
  }
})
