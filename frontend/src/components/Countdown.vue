<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { formatClock } from '@/utils/format'

const props = defineProps<{
  endTime: number | null
}>()

const emit = defineEmits<{
  ended: []
}>()

const now = ref(Date.now())
let timer: number | undefined
let endedEmitted = false

function start() {
  stop()
  timer = window.setInterval(() => {
    now.value = Date.now()
    if (props.endTime != null && now.value >= props.endTime && !endedEmitted) {
      endedEmitted = true
      emit('ended')
    }
  }, 250)
}

function stop() {
  if (timer != null) {
    window.clearInterval(timer)
    timer = undefined
  }
}

watch(
  () => props.endTime,
  (t) => {
    if (t != null && t > Date.now()) endedEmitted = false
    start()
  },
  { immediate: true },
)

onBeforeUnmount(stop)

const remainMs = computed(() => {
  if (props.endTime == null) return null
  return props.endTime - now.value
})

const display = computed(() => (remainMs.value == null ? '--:--' : formatClock(remainMs.value)))
const urgent = computed(() => remainMs.value != null && remainMs.value > 0 && remainMs.value <= 15_000)
const over = computed(() => remainMs.value != null && remainMs.value <= 0)
</script>

<template>
  <span class="countdown mono" :class="{ urgent, over }">{{ display }}</span>
</template>

<style scoped>
.countdown {
  font-size: 22px;
  font-weight: 700;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.countdown.urgent {
  color: var(--danger);
  animation: dot-pulse 1s ease-in-out infinite;
}

.countdown.over {
  color: var(--muted);
}
</style>
