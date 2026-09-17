import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Device, Alarm, DeviceError, DeviceOpResult, BatchOpResult } from '../types'

const STORAGE_KEY = 'modbus-monitor-state-v2'
const HISTORY_LIMIT = 100

interface PersistedState {
  devices: Array<Pick<Device, 'id' | 'online' | 'collecting' | 'error'>>
  pollInterval: number
  selectedDeviceId: string | null
}

export const useModbusStore = defineStore('modbus', () => {
  const devices = ref<Device[]>([])
  const alarms = ref<Alarm[]>([])
  const historyData = ref<Record<string, { time: number[]; values: number[] }>>({})
  const pollInterval = ref(1000)
  const selectedDevice = ref<Device | null>(null)
  /** 侧栏多选（批量启停用） */
  const checkedIds = ref<string[]>([])
  /** 批量启停结果（逐台） */
  const batchResults = ref<BatchOpResult[]>([])

  // isPolling：有任意设备处于采集中即处于采集态；由设备开关派生，始终与各设备开关一致
  const isPolling = computed(() => devices.value.some(d => d.collecting))
  const criticalAlarms = computed(() => alarms.value.filter(a => a.level === 'critical' && !a.acknowledged))
  const onlineDevices = computed(() => devices.value.filter(d => d.online))
  const collectingDevices = computed(() => devices.value.filter(d => d.collecting))
  const checkedDevices = computed(() => devices.value.filter(d => checkedIds.value.includes(d.id)))
  const selectedDeviceId = computed(() => selectedDevice.value?.id ?? null)

  // ---------- mock 设备 ----------
  function createMockDevices(): Device[] {
    const now = Date.now()
    return [
      {
        id: 'dev1', name: '温湿度传感器-A区', ip: '192.168.1.101', port: 502, slaveId: 1,
        online: true, collecting: false, error: null, lastPollAt: null,
        registers: [
          { address: 0, name: '温度', type: 'holding', value: 25.6, unit: '°C', updatedAt: now },
          { address: 1, name: '湿度', type: 'holding', value: 62.3, unit: '%RH', updatedAt: now },
          { address: 2, name: '露点', type: 'holding', value: 17.8, unit: '°C', updatedAt: now },
        ]
      },
      {
        id: 'dev2', name: '压力变送器-B区', ip: '192.168.1.102', port: 502, slaveId: 2,
        online: true, collecting: false, error: null, lastPollAt: null,
        registers: [
          { address: 0, name: '管道压力', type: 'holding', value: 3.45, unit: 'MPa', updatedAt: now },
          { address: 1, name: '差压', type: 'holding', value: 0.12, unit: 'kPa', updatedAt: now },
        ]
      },
      {
        id: 'dev3', name: '电机控制器-C区', ip: '192.168.1.103', port: 502, slaveId: 3,
        online: false, collecting: false, error: null, lastPollAt: null,
        registers: [
          { address: 0, name: '转速', type: 'holding', value: 1480, unit: 'RPM', updatedAt: now },
          { address: 1, name: '电流', type: 'holding', value: 12.5, unit: 'A', updatedAt: now },
          { address: 2, name: '运行状态', type: 'coil', value: true, unit: '', updatedAt: now },
        ]
      },
      {
        id: 'dev4', name: '流量计-D区', ip: '192.168.1.104', port: 502, slaveId: 4,
        online: true, collecting: false, error: null, lastPollAt: null,
        registers: [
          { address: 0, name: '瞬时流量', type: 'holding', value: 156.7, unit: 'L/min', updatedAt: now },
          { address: 1, name: '累计流量', type: 'holding', value: 98234, unit: 'L', updatedAt: now },
        ]
      },
    ]
  }

  function initMockDevices() {
    devices.value = createMockDevices()
    const persisted = loadPersisted()
    if (persisted) {
      pollInterval.value = persisted.pollInterval
      for (const d of devices.value) {
        const snap = persisted.devices.find(p => p.id === d.id)
        if (!snap) continue
        d.online = snap.online
        // 采集开关状态刷新后保持；刷新前处于采集中的设备回来继续采集
        d.collecting = snap.collecting
        // 上次掉线/失败只是上一轮的瞬时状态，回来后重新尝试一轮再决定
        d.error = null
      }
      const sel = persisted.selectedDeviceId
        ? devices.value.find(d => d.id === persisted.selectedDeviceId)
        : undefined
      selectedDevice.value = sel ?? devices.value[0] ?? null
      // 回来后对还在采集的设备立刻尝试一轮：在线的成功、掉线的重新被标出
      for (const d of devices.value) if (d.collecting) startDevice(d.id)
    } else {
      selectedDevice.value = devices.value[0] ?? null
    }
  }

  // ---------- 持久化：切换选中设备 / 调整间隔 / 开关采集都不丢，刷新也能看出谁在采集 ----------
  function loadPersisted(): PersistedState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) as PersistedState : null
    } catch {
      return null
    }
  }

  function persist() {
    const snap: PersistedState = {
      devices: devices.value.map(d => ({
        id: d.id, online: d.online, collecting: d.collecting, error: d.error
      })),
      pollInterval: pollInterval.value,
      selectedDeviceId: selectedDeviceId.value,
    }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snap)) } catch { /* ignore */ }
  }

  // 只持久化设备开关/在线/异常标志：寄存器数值每秒变化不触发写入
  const persistedSnapshot = computed(() =>
    devices.value.map(d => [d.id, d.online, d.collecting, d.error] as const)
  )
  watch([persistedSnapshot, pollInterval, selectedDeviceId], persist)

  // ---------- 单台读数（mock 通讯）：掉线或读数失败单独返回，不影响其他设备 ----------
  function readDevice(dev: Device): { ok: boolean; error: DeviceError } {
    if (!dev.online) return { ok: false, error: 'offline' }
    // 模拟偶发通讯超时（约 4%），用于演示“读数失败”分支
    if (Math.random() < 0.04) return { ok: false, error: 'read_failed' }

    const now = Date.now()
    for (const reg of dev.registers) {
      if (typeof reg.value === 'number') {
        const noise = (Math.random() - 0.5) * reg.value * 0.02
        reg.value = Math.round((reg.value + noise) * 100) / 100
        reg.updatedAt = now
        const key = `${dev.id}_${reg.address}`
        if (!historyData.value[key]) historyData.value[key] = { time: [], values: [] }
        historyData.value[key].time.push(now)
        historyData.value[key].values.push(reg.value)
        if (historyData.value[key].time.length > HISTORY_LIMIT) {
          historyData.value[key].time.shift()
          historyData.value[key].values.shift()
        }
        // Check thresholds
        if (reg.name === '温度' && reg.value > 28) {
          alarms.value.unshift({
            id: `a_${now}_${Math.random().toString(36).slice(2, 7)}`,
            deviceId: dev.id, register: reg.name,
            message: `${dev.name} ${reg.name}超限: ${reg.value}${reg.unit}`,
            level: reg.value > 30 ? 'critical' : 'warning',
            timestamp: now, acknowledged: false
          })
        }
      } else {
        reg.updatedAt = now
      }
    }
    dev.lastPollAt = now
    return { ok: true, error: null }
  }

  /** 每轮轮询：只采集开关打开的设备；失败的一台单独标出并自动跳过，其余继续 */
  function simulatePoll() {
    for (const dev of devices.value) {
      if (!dev.collecting || dev.error) continue
      const res = readDevice(dev)
      if (!res.ok) dev.error = res.error
    }
    if (alarms.value.length > 50) alarms.value = alarms.value.slice(0, 50)
  }

  // ---------- 单台启停 ----------
  function startDevice(id: string): DeviceOpResult {
    const dev = devices.value.find(d => d.id === id)
    if (!dev) {
      return { deviceId: id, deviceName: id, action: 'start', success: false, message: '设备不存在' }
    }
    dev.collecting = true
    // 开始前清掉上一轮的失败标记，立刻试读一轮验证链路
    dev.error = null
    const res = readDevice(dev)
    if (!res.ok) {
      dev.error = res.error
      return {
        deviceId: dev.id, deviceName: dev.name, action: 'start', success: false,
        message: res.error === 'offline' ? '设备掉线，已挂起等待重试' : '读数失败（通讯超时），已挂起等待重试'
      }
    }
    return { deviceId: dev.id, deviceName: dev.name, action: 'start', success: true, message: '已开始采集' }
  }

  function stopDevice(id: string): DeviceOpResult {
    const dev = devices.value.find(d => d.id === id)
    if (!dev) {
      return { deviceId: id, deviceName: id, action: 'stop', success: false, message: '设备不存在' }
    }
    dev.collecting = false
    // 手动停止时清掉失败标记：下次开始是一次全新的尝试
    dev.error = null
    return { deviceId: dev.id, deviceName: dev.name, action: 'stop', success: true, message: '已停止采集' }
  }

  /** 失败设备重试：开关状态保持不变，重新尝试读数 */
  function retryDevice(id: string): DeviceOpResult {
    const dev = devices.value.find(d => d.id === id)
    if (!dev) {
      return { deviceId: id, deviceName: id, action: 'start', success: false, message: '设备不存在' }
    }
    dev.collecting = true
    dev.error = null
    const res = readDevice(dev)
    if (!res.ok) {
      dev.error = res.error
      return {
        deviceId: dev.id, deviceName: dev.name, action: 'start', success: false,
        message: res.error === 'offline' ? '重试失败：设备仍掉线' : '重试失败：读数超时'
      }
    }
    return { deviceId: dev.id, deviceName: dev.name, action: 'start', success: true, message: '重试成功，已恢复采集' }
  }

  // ---------- 多选批量启停，逐台给出结果 ----------
  function batchStart(ids: string[]): BatchOpResult | null {
    if (!ids.length) return null
    const items = ids.map(id => startDevice(id))
    const result: BatchOpResult = { id: `b_${Date.now()}_${ids.length}`, action: 'start', time: Date.now(), items }
    batchResults.value.unshift(result)
    trimResults()
    return result
  }

  function batchStop(ids: string[]): BatchOpResult | null {
    if (!ids.length) return null
    const items = ids.map(id => stopDevice(id))
    const result: BatchOpResult = { id: `b_${Date.now()}_${ids.length}`, action: 'stop', time: Date.now(), items }
    batchResults.value.unshift(result)
    trimResults()
    return result
  }

  function dismissBatch(id: string) {
    batchResults.value = batchResults.value.filter(r => r.id !== id)
  }

  /** 单台重试同样产出一条逐台结果，与批量操作共用结果面板 */
  function retryOne(id: string): BatchOpResult {
    const item = retryDevice(id)
    const result: BatchOpResult = { id: `b_${Date.now()}_r`, action: 'start', time: Date.now(), items: [item] }
    batchResults.value.unshift(result)
    trimResults()
    return result
  }

  function trimResults() {
    if (batchResults.value.length > 5) batchResults.value = batchResults.value.slice(0, 5)
  }

  // ---------- 侧栏多选 ----------
  function toggleChecked(id: string) {
    if (checkedIds.value.includes(id)) {
      checkedIds.value = checkedIds.value.filter(x => x !== id)
    } else {
      checkedIds.value = [...checkedIds.value, id]
    }
  }

  function selectDevice(dev: Device) {
    selectedDevice.value = dev
  }

  function acknowledgeAlarm(id: string) {
    const a = alarms.value.find(a => a.id === id)
    if (a) a.acknowledged = true
  }

  /** 在线/离线模拟切换（侧栏在线状态与卡片区共用同一数据源） */
  function toggleDevice(id: string) {
    const d = devices.value.find(d => d.id === id)
    if (!d) return
    d.online = !d.online
    // 掉线瞬间，正在采集的设备本轮即失败；重新上线后若开关仍开着，自动恢复
    if (!d.online && d.collecting) {
      d.error = 'offline'
    } else if (d.online && d.collecting && d.error) {
      const res = readDevice(d)
      if (!res.ok) d.error = res.error
    }
  }

  return {
    devices, alarms, historyData, pollInterval, selectedDevice, checkedIds, batchResults,
    isPolling, criticalAlarms, onlineDevices, collectingDevices, checkedDevices,
    initMockDevices, simulatePoll, readDevice,
    startDevice, stopDevice, retryDevice, batchStart, batchStop, dismissBatch, retryOne,
    toggleChecked, selectDevice, acknowledgeAlarm, toggleDevice
  }
})
