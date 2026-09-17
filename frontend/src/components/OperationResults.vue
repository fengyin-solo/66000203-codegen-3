<template>
  <div class="fixed right-4 bottom-4 w-80 flex flex-col gap-2 z-50">
    <div v-for="r in store.batchResults" :key="r.id"
      class="bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
      <div class="flex items-center justify-between px-3 py-2 bg-gray-900/60">
        <span class="text-xs font-bold" :class="hasFailure(r) ? 'text-yellow-400' : 'text-green-400'">
          {{ r.action === 'start' ? '批量开始' : '批量停止' }} ·
          成功 {{ successCount(r) }}/{{ r.items.length }}
          <template v-if="hasFailure(r)">（{{ failCount(r) }} 台失败）</template>
        </span>
        <button @click="store.dismissBatch(r.id)" class="text-gray-500 hover:text-gray-300 text-xs leading-none">✕</button>
      </div>
      <div class="max-h-44 overflow-y-auto">
        <div v-for="item in r.items" :key="item.deviceId"
          class="flex items-center justify-between gap-2 px-3 py-1.5 text-xs border-t border-gray-700/50">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span :class="item.success ? 'text-green-400' : 'text-red-400'">{{ item.success ? '✓' : '✕' }}</span>
              <span class="truncate text-gray-200">{{ item.deviceName }}</span>
            </div>
            <div class="text-gray-500 truncate pl-4">{{ item.message }}</div>
          </div>
          <button v-if="!item.success && item.action === 'start'"
            @click="store.retryOne(item.deviceId)"
            class="shrink-0 px-2 py-1 bg-orange-600 hover:bg-orange-500 rounded text-white text-[11px]">
            重试
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BatchOpResult } from '../types'
import { useModbusStore } from '../store/modbus'

const store = useModbusStore()

function successCount(r: BatchOpResult) {
  return r.items.filter(i => i.success).length
}
function failCount(r: BatchOpResult) {
  return r.items.filter(i => !i.success).length
}
function hasFailure(r: BatchOpResult) {
  return failCount(r) > 0
}
</script>
