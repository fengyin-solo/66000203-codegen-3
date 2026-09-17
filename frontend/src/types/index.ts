export interface ModbusRegister {
  address: number
  name: string
  type: 'coil' | 'discrete' | 'holding' | 'input'
  value: number | boolean
  unit: string
  updatedAt: number
}

/** 设备单台读数/启停失败的原因 */
export type DeviceError = 'offline' | 'read_failed' | null

export interface Device {
  id: string
  name: string
  ip: string
  port: number
  slaveId: number
  online: boolean
  /** 用户侧采集开关：是否参与采集（掉线时也会保留该意图） */
  collecting: boolean
  /** 最近一次开始/轮询失败的原因，null 表示正常 */
  error: DeviceError
  /** 最近一次成功读数的时间戳 */
  lastPollAt: number | null
  registers: ModbusRegister[]
}

export interface Alarm {
  id: string
  deviceId: string
  register: string
  message: string
  level: 'info' | 'warning' | 'critical'
  timestamp: number
  acknowledged: boolean
}

/** 批量启停里单台设备的操作结果 */
export interface DeviceOpResult {
  deviceId: string
  deviceName: string
  action: 'start' | 'stop'
  success: boolean
  message: string
}

/** 一次批量操作的结果汇总 */
export interface BatchOpResult {
  id: string
  action: 'start' | 'stop'
  time: number
  items: DeviceOpResult[]
}
