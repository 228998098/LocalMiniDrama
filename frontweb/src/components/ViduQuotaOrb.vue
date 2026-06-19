<template>
  <div v-if="visible" class="vidu-quota-orb" @mouseenter="hovering = true" @mouseleave="hovering = false">
    <!-- 球体容器 -->
    <div class="orb" :class="{ 'orb--low': isLow, 'orb--loading': loading }">
      <!-- 液体层：从球底向上填充，高度=百分比 -->
      <div class="orb-liquid-wrap" :style="liquidWrapStyle">
        <!-- 液体主体（填满 wrap）-->
        <div class="orb-liquid-body"></div>
        <!-- 液面波浪（贴在液体顶部，无缝循环）-->
        <div class="orb-wave-track">
          <svg class="orb-wave" viewBox="0 0 240 20" preserveAspectRatio="none">
            <path :d="wavePath" class="wave-fill wave-1" />
          </svg>
          <svg class="orb-wave orb-wave--back" viewBox="0 0 240 20" preserveAspectRatio="none">
            <path :d="wavePath2" class="wave-fill wave-2" />
          </svg>
        </div>
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

// 额度查询用独立 axios 实例，绕过全局 request 拦截器的 ElMessage 弹窗
// （每分钟后台刷新，失败时静默降级，不打扰用户）
const quotaRequest = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

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

// 液体高度：液体从球底填充，高度 = 百分比。wrap 贴球底（bottom:0），高度=百分比，
// 这样 100% 时 wrap 占满整个球，液体满；50% 时 wrap 占下半球。
const liquidWrapStyle = computed(() => ({
  height: (percent.value * 100) + '%',
  bottom: '0',
  top: 'auto',
}))

// 无缝波浪 path：viewBox 0 0 240 20，画两个完整周期（0-120, 120-240），
// 首尾 y 值相同。translateX(-50%) 平移一个周期(120)，第二周期补位，无缝循环。
const wavePath = 'M0,10 Q30,2 60,10 T120,10 T180,10 T240,10 V20 H0 Z'
const wavePath2 = 'M0,10 Q30,18 60,10 T120,10 T180,10 T240,10 V20 H0 Z'

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
    // 后端 response.success 返回 { success, data }；这里取 data 字段
    const { data: resp } = await quotaRequest.get('/vidu-cli/quota')
    const d = resp?.data || resp
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
    // 额度查询失败不打扰用户（后台静默降级），仅控件显示失败
    hasData.value = false
    unavailableMsg.value = '查询失败'
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

/* 液体层：从球底向上填充，高度=百分比（bottom:0 + height:%） */
.orb-liquid-wrap {
  position: absolute;
  left: 0;
  width: 100%;
  bottom: 0;
  overflow: hidden;
  transition: height 0.8s ease;
}
/* 液体主体：填满整个 wrap（纯蓝色背景），100% 时整个球都是液体 */
.orb-liquid-body {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.92) 0%, rgba(37, 99, 235, 0.95) 100%);
}
/* 液面波浪轨道：贴在液体顶部，溢出隐藏让波浪在液面水平循环 */
.orb-wave-track {
  position: absolute;
  left: 0;
  top: -10px;
  width: 100%;
  height: 20px;
  overflow: hidden;
}
.orb-wave {
  position: absolute;
  left: 0;
  top: 0;
  width: 200%;
  height: 20px;
  display: block;
}
.orb-wave--back {
  opacity: 0.55;
}
.wave-fill {
  fill: #3b82f6;
}
.wave-1 {
  fill: rgba(59, 130, 246, 0.92);
  animation: wave-move 5s linear infinite;
}
.wave-2 {
  fill: rgba(96, 165, 250, 0.6);
  animation: wave-move 7s linear infinite reverse;
}
@keyframes wave-move {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

/* 低额度警告色 */
.orb--low .orb-liquid-body { background: linear-gradient(180deg, rgba(239, 68, 68, 0.92) 0%, rgba(220, 38, 38, 0.95) 100%); }
.orb--low .wave-1 { fill: rgba(239, 68, 68, 0.92); }
.orb--low .wave-2 { fill: rgba(248, 113, 113, 0.6); }

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
