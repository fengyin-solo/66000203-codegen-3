export interface ModbusRegister {
  address: number
  name: string
  type: 'coil' | 'discrete' | 'holding' | 'input'
  value: number | boolean
  unit: string
  updatedAt: number
}

export interface Device {
  id: string
  name: string
  ip: string
  port: number
  slaveId: number
  online: boolean
  registers: ModbusRegister[]
  /** 该设备当前是否参与采集（可逐台开关，与 online 在线状态相互独立） */
  collecting: boolean
  /** 最近一次读数/掉线错误信息；非空时卡片与侧栏单独标出，可重试 */
  error: string | null
}

export type CollectAction = 'start' | 'stop' | 'retry' | 'fault'

export interface CollectOpResult {
  id: string
  deviceId: string
  deviceName: string
  action: CollectAction
  success: boolean
  message: string
  timestamp: number
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
