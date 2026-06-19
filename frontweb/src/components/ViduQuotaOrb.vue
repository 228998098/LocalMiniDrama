<template>
  <div v-if="visible" class="vidu-quota-orb" @mouseenter="hovering = true" @mouseleave="hovering = false">
    <!-- 球体容器 -->
    <div class="orb" :class="{ 'orb--low': isLow, 'orb--loading': loading }">
      <!-- 液体层（SVG 波浪）-->
      <div class="orb-liquid-wrap" :style="liquidWrapStyle">
        <svg class="orb-wave" viewBox="0 0 120 40" preserveAspectRatio="none">
          <path :d="wavePath1" class="wave-fill wave-1" />
          <path :d="wavePath2" class="wave-fill wave-2" />
        </svg>
      </div>
      <!-- 球体高光（伪3D）-->
      <div class="orb-highlight"></div>
      <!-- 球体边框 -->
      <div class="orb-ring"></div>
      <!-- 球体内文字（百分比）-->
      <div v-if="!loading && hasData" class="orb-text">{{ percentText }}</div>
      <div v-else-if="loading" class="orb-text orb-text--sm">…</div>
    </div>
    <!-- hover tooltip -->
    <transition name="fade">
      <div v-show="hovering" class="orb-tooltip">
        <template v-if="hasData">
          <div class="tt-main">{{ remainSeconds }}s / {{ totalSeconds }}s</div>
          <div class="tt-sub">{{ percentText }} 剩余</div>
          <div v-if="refreshAt" class="tt-sub tt-sub--dim">下次刷新 {{ refreshAtText }}</div>
        </template>
        <template v-else-if="!loading">
          <div class="tt-main">{{ unavailableMsg }}</div>
        </template>
        <template v-else>
          <div class="tt-main">查询中…</div>
        </template>
      </div>
    </transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import axios from 'axios'

const REFRESH_INTERVAL = 60 * 1000 // 每 1 分钟刷新

const loading = ref(true)
const hovering = ref(false)
const visible = ref(true)
const hasData = ref(false)
const unavailableMsg = ref('未配置 vidu-cli')
const remainSeconds = ref(0)
const totalSeconds = ref(0)
const refreshAt = ref('')

const percent = computed(() => {
  if (!totalSeconds.value || totalSeconds.value <= 0) return 0
  return Math.max(0, Math.min(1, remainSeconds.value / totalSeconds.value))
})
const percentText = computed(() => Math.round(percent.value * 100) + '%')
const isLow = computed(() => hasData.value && percent.value < 0.2)

// 液体高度：液体从球底填充，高度 = 百分比。液面在球体内的纵向位置。
const liquidWrapStyle = computed(() => ({
  // 液体层高度占球体的百分比；液面位置 = (1-百分比) 从顶部
  height: (percent.value * 100) + '%',
  top: ((1 - percent.value) * 100) + '%',
}))

// 两条波浪 path（用于波动叠加），用固定波形 + CSS 平移
const wavePath1 = 'M0,20 Q30,10 60,20 T120,20 V40 H0 Z'
const wavePath2 = 'M0,20 Q30,30 60,20 T120,20 V40 H0 Z'

const refreshAtText = computed(() => {
  if (!refreshAt.value) return ''
  try {
    const d = new Date(refreshAt.value)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch { return refreshAt.value }
})

async function fetchQuota() {
  loading.value = true
  try {
    const { data } = await axios.get('/api/vidu-cli/quota')
    const d = data?.data || data
    if (d && d.available && d.daily_quota_seconds != null) {
      hasData.value = true
      remainSeconds.value = Number(d.remain_seconds) || 0
      totalSeconds.value = Number(d.daily_quota_seconds) || 0
      refreshAt.value = d.next_refresh_at || ''
    } else {
      hasData.value = false
      unavailableMsg.value = (d && d.message) || '未配置 vidu-cli'
    }
  } catch (e) {
    hasData.value = false
    unavailableMsg.value = '查询失败：' + (e.message || e)
  } finally {
    loading.value = false
  }
}

let timer = null
onMounted(() => {
  fetchQuota()
  timer = setInterval(fetchQuota, REFRESH_INTERVAL)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.vidu-quota-orb {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 9999;
  cursor: pointer;
  user-select: none;
}

.orb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  background: radial-gradient(circle at 35% 30%, #2a3550 0%, #1a2238 60%, #0f1626 100%);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.45),
    inset 0 -6px 12px rgba(0, 0, 0, 0.4),
    inset 0 4px 8px rgba(120, 180, 255, 0.15);
  transition: transform 0.2s ease;
}
.vidu-quota-orb:hover .orb {
  transform: scale(1.08);
}

/* 液体层：绝对定位，从球底向上填充 */
.orb-liquid-wrap {
  position: absolute;
  left: 0;
  width: 100%;
  overflow: hidden;
  transition: height 0.8s ease, top 0.8s ease;
}
.orb-wave {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 200%;
  height: 40px;
}
.wave-fill {
  fill: #3b82f6;
}
.wave-1 {
  fill: rgba(59, 130, 246, 0.85);
  animation: wave-move 4s linear infinite;
}
.wave-2 {
  fill: rgba(96, 165, 250, 0.55);
  animation: wave-move 6s linear infinite reverse;
}
@keyframes wave-move {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* 低额度警告色 */
.orb--low .wave-1 { fill: rgba(239, 68, 68, 0.85); }
.orb--low .wave-2 { fill: rgba(248, 113, 113, 0.55); }

/* 球体高光（伪3D 玻璃感）*/
.orb-highlight {
  position: absolute;
  top: 8%;
  left: 18%;
  width: 38%;
  height: 30%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.45) 0%, rgba(255, 255, 255, 0.1) 50%, transparent 70%);
  pointer-events: none;
}

/* 球体边框圈 */
.orb-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1.5px solid rgba(120, 180, 255, 0.25);
  box-shadow: inset 0 0 8px rgba(120, 180, 255, 0.1);
  pointer-events: none;
}

.orb-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}
.orb-text--sm { font-size: 18px; font-weight: 400; }

.orb--loading { opacity: 0.7; }

/* tooltip */
.orb-tooltip {
  position: absolute;
  right: 76px;
  bottom: 8px;
  background: rgba(15, 22, 38, 0.95);
  color: #e2e8f0;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  white-space: nowrap;
  border: 1px solid rgba(120, 180, 255, 0.2);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.tt-main { font-weight: 600; color: #93c5fd; }
.tt-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.tt-sub--dim { color: #64748b; }

.fade-enter-active, .fade-leave-active { transition: opacity 0.18s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
